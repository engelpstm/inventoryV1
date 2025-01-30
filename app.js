const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const QRCode = require('qrcode');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const bcrypt = require('bcrypt');
const app = express();

// Configuração do EJS como view engine
app.set('view engine', 'ejs');

// Configuração da sessão
app.use(session({
    secret: 'sua_chave_secreta_aqui',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // set to true if using https
        maxAge: 24 * 60 * 60 * 1000 // 24 horas
    }
}));

// Configuração do Multer para upload de imagens
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = 'public/uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    fileFilter: function (req, file, cb) {
        const filetypes = /jpeg|jpg|png/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Apenas imagens são permitidas!'));
    }
});

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));

// Conexão com o banco de dados
const pool = new Pool({
    user: 'inventario_s4kr_user',
    host: 'dpg-cudcbj3tq21c738d7160-a',
    database: 'inventario_s4kr',
    password: 'OCXtQN6TIXzXnpvjIfcmb8kwFY1A5I7E',
    port: 5432
});

// Teste a conexão
pool.connect((err, client, done) => {
    if (err) {
        console.error('Erro ao conectar ao banco de dados:', err);
    } else {
        console.log('Conexão com o banco de dados estabelecida com sucesso!');
        done();
    }
});

// Middleware de autenticação
const requireLogin = (req, res, next) => {
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/login');
    }
};

// Criar tabelas se não existirem
const createTables = [
    `CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS localizacoes (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(255) NOT NULL UNIQUE
    )`,
    `CREATE TABLE IF NOT EXISTS bens (
        id SERIAL PRIMARY KEY,
        descricao VARCHAR(255) NOT NULL,
        localizacao_id INTEGER NOT NULL,
        data_cadastro DATE NOT NULL,
        imagem VARCHAR(255),
        qrcode VARCHAR(255),
        FOREIGN KEY (localizacao_id) REFERENCES localizacoes(id)
    )`
];

createTables.forEach(query => {
    pool.query(query, (err) => {
        if (err) {
            console.error('Erro ao criar tabela:', err);
        }
    });
});

// Criar usuário admin padrão se não existir
const createAdminUser = async () => {
    try {
        const result = await pool.query('SELECT * FROM usuarios WHERE username = $1', ['admin']);
        if (result.rows.length === 0) {
            const hashedPassword = await bcrypt.hash('admin', 10);
            await pool.query(
                'INSERT INTO usuarios (username, password) VALUES ($1, $2)',
                ['admin', hashedPassword]
            );
            console.log('Usuário admin criado com sucesso');
        }
    } catch (err) {
        console.error('Erro ao criar usuário admin:', err);
    }
};

createAdminUser();

// Rotas de autenticação
app.get('/login', (req, res) => {
    if (req.session.userId) {
        res.redirect('/');
    } else {
        res.render('login');
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const result = await pool.query('SELECT * FROM usuarios WHERE username = $1', [username]);
        
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Usuário não encontrado' });
        }

        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password);

        if (!validPassword) {
            return res.status(401).json({ error: 'Senha incorreta' });
        }

        req.session.userId = user.id;
        req.session.username = user.username;
        res.json({ success: true });

    } catch (err) {
        console.error('Erro no login:', err);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// Rotas
// Página inicial - Lista todos os bens
app.get('/', requireLogin, (req, res) => {
    pool.query(
        `SELECT b.*, l.nome as localizacao_nome 
         FROM bens b 
         JOIN localizacoes l ON b.localizacao_id = l.id 
         ORDER BY b.id`,
        (err, results) => {
            if (err) throw err;
            res.render('index', { bens: results.rows });
        }
    );
});

// Adicionar novo bem
app.post('/adicionar', requireLogin, upload.single('imagem'), (req, res) => {
    const { id, descricao, localizacao_id } = req.body;
    const data_cadastro = new Date().toISOString().slice(0, 10);
    const imagem = req.file ? '/uploads/' + req.file.filename : null;
    
    pool.query(
        'INSERT INTO bens (id, descricao, localizacao_id, data_cadastro, imagem) VALUES ($1, $2, $3, $4, $5)',
        [id, descricao, localizacao_id, data_cadastro, imagem],
        (err, result) => {
            if (err) {
                if (err.code === '23505') {
                    res.status(400).send(`O ID ${id} já está em uso. Por favor, escolha um ID diferente.`);
                    return;
                }
                res.status(500).send('Erro ao cadastrar o bem. Por favor, tente novamente.');
                return;
            }
            res.json({ success: true, id: id });
        }
    );
});

// Página de edição
app.get('/editar/:id', requireLogin, (req, res) => {
    pool.query(
        'SELECT * FROM bens WHERE id = $1',
        [req.params.id],
        (err, results) => {
            if (err) throw err;
            res.render('editar', { bem: results.rows[0] });
        }
    );
});

// Atualizar bem
app.post('/atualizar/:id', requireLogin, (req, res) => {
    const { descricao, localizacao_id } = req.body;
    
    pool.query(
        'UPDATE bens SET descricao = $1, localizacao_id = $2 WHERE id = $3',
        [descricao, localizacao_id, req.params.id],
        (err) => {
            if (err) throw err;
            res.redirect('/');
        }
    );
});

// Excluir bem
app.get('/excluir/:id', requireLogin, (req, res) => {
    pool.query(
        'DELETE FROM bens WHERE id = $1',
        [req.params.id],
        (err) => {
            if (err) throw err;
            res.redirect('/');
        }
    );
});

// Rotas para Localizações
app.get('/api/localizacoes', requireLogin, (req, res) => {
    pool.query('SELECT * FROM localizacoes ORDER BY nome', (err, results) => {
        if (err) {
            res.status(500).send('Erro ao buscar localizações');
            return;
        }
        res.json(results.rows);
    });
});

app.post('/api/localizacoes', requireLogin, (req, res) => {
    const { nome } = req.body;
    
    // Validar se o nome foi fornecido e não está vazio
    if (!nome || !nome.trim()) {
        res.status(400).send('O nome da localização é obrigatório');
        return;
    }

    // Remover espaços extras e normalizar o nome
    const nomeNormalizado = nome.trim();

    pool.query(
        'INSERT INTO localizacoes (nome) VALUES ($1) RETURNING id, nome',
        [nomeNormalizado],
        (err, result) => {
            if (err) {
                if (err.code === '23505') {
                    res.status(400).send('Esta localização já existe');
                    return;
                }
                console.error('Erro ao inserir localização:', err);
                res.status(500).send('Erro ao criar localização');
                return;
            }
            res.json({ id: result.rows[0].id, nome: nomeNormalizado });
        }
    );
});

app.put('/api/localizacoes/:id', requireLogin, (req, res) => {
    const { id } = req.params;
    const { nome } = req.body;
    
    pool.query(
        'UPDATE localizacoes SET nome = $1 WHERE id = $2',
        [nome, id],
        (err) => {
            if (err) {
                if (err.code === '23505') {
                    res.status(400).send('Esta localização já existe');
                    return;
                }
                res.status(500).send('Erro ao atualizar localização');
                return;
            }
            res.json({ id, nome });
        }
    );
});

app.delete('/api/localizacoes/:id', requireLogin, (req, res) => {
    const { id } = req.params;
    
    pool.query(
        'DELETE FROM localizacoes WHERE id = $1',
        [id],
        (err) => {
            if (err) {
                if (err.code === '23503') {
                    res.status(400).send('Esta localização está em uso e não pode ser excluída');
                    return;
                }
                res.status(500).send('Erro ao excluir localização');
                return;
            }
            res.json({ success: true });
        }
    );
});

// Rota para a página de QR Code
app.get('/qrcode', requireLogin, (req, res) => {
    res.render('qrcode');
});

// API para buscar bem por ID e gerar QR Code
app.get('/api/bem/:id', requireLogin, async (req, res) => {
    const { id } = req.params;
    
    pool.query(
        `SELECT b.*, l.nome as localizacao_nome 
         FROM bens b 
         JOIN localizacoes l ON b.localizacao_id = l.id 
         WHERE b.id = $1`,
        [id],
        async (err, results) => {
            if (err) {
                console.error('Erro ao buscar bem:', err);
                res.status(500).send('Erro ao buscar bem');
                return;
            }

            if (results.rows.length === 0) {
                res.status(404).send('Bem não encontrado');
                return;
            }

            const bem = results.rows[0];
            
            try {
                // Criar objeto com informações para o QR Code
                const qrData = {
                    id: bem.id,
                    descricao: bem.descricao,
                    localizacao: bem.localizacao_nome,
                    data_cadastro: bem.data_cadastro
                };

                // Gerar QR Code como URL de dados (base64)
                const qrcode = await QRCode.toDataURL(JSON.stringify(qrData));
                
                // Adicionar QR Code ao objeto de resposta
                res.json({
                    ...bem,
                    qrcode
                });
            } catch (error) {
                console.error('Erro ao gerar QR code:', error);
                res.status(500).send('Erro ao gerar QR code');
            }
        }
    );
});

// Gerar QR Code para um bem
app.post('/gerar-qrcode/:id', requireLogin, async (req, res) => {
    try {
        const id = req.params.id;
        const qrCodeData = `http://${req.get('host')}/bem/${id}`;
        const qrCodeFileName = `qrcode_${id}.png`;
        const qrCodePath = path.join('public', 'qrcodes', qrCodeFileName);
        
        // Criar diretório se não existir
        const qrCodeDir = path.join('public', 'qrcodes');
        if (!fs.existsSync(qrCodeDir)) {
            fs.mkdirSync(qrCodeDir, { recursive: true });
        }

        // Gerar QR code
        await QRCode.toFile(qrCodePath, qrCodeData);
        
        // Atualizar o registro no banco de dados
        pool.query(
            'UPDATE bens SET qrcode = $1 WHERE id = $2',
            [`/qrcodes/${qrCodeFileName}`, id],
            (err) => {
                if (err) {
                    console.error('Erro ao atualizar QR code:', err);
                    res.status(500).json({ error: 'Erro ao gerar QR code' });
                    return;
                }
                res.json({ qrcode: `/qrcodes/${qrCodeFileName}` });
            }
        );
    } catch (error) {
        console.error('Erro ao gerar QR code:', error);
        res.status(500).json({ error: 'Erro ao gerar QR code' });
    }
});

// Verificar se um bem existe
app.get('/verificar-bem/:id', requireLogin, (req, res) => {
    const bemId = req.params.id;
    console.log('Verificando bem com ID:', bemId);

    // Validar o ID
    const numericId = parseInt(bemId, 10);
    if (isNaN(numericId) || numericId <= 0 || numericId > 999999) {
        console.error('ID inválido:', bemId);
        res.status(400).json({ 
            error: 'ID inválido', 
            exists: false,
            message: 'O ID deve ser um número entre 1 e 999999'
        });
        return;
    }

    pool.query(
        'SELECT id FROM bens WHERE id = $1',
        [numericId],
        (err, results) => {
            if (err) {
                console.error('Erro ao verificar bem no banco:', err);
                res.status(500).json({ 
                    error: 'Erro ao verificar bem', 
                    details: err.message,
                    exists: false 
                });
                return;
            }

            console.log('Resultado da consulta:', results.rows);
            res.json({ 
                exists: results.rows.length > 0,
                message: results.rows.length > 0 ? 'Bem encontrado' : 'Bem não encontrado'
            });
        }
    );
});

// Rota para visualizar um bem específico
app.get('/bem/:id', requireLogin, (req, res) => {
    pool.query(
        `SELECT b.*, l.nome as localizacao_nome 
         FROM bens b 
         JOIN localizacoes l ON b.localizacao_id = l.id 
         WHERE b.id = $1`,
        [req.params.id],
        (err, results) => {
            if (err) {
                console.error('Erro ao buscar bem:', err);
                res.status(500).send('Erro ao buscar bem');
                return;
            }
            
            if (results.rows.length === 0) {
                res.status(404).send('Bem não encontrado');
                return;
            }
            
            res.render('bem', { bem: results.rows[0] });
        }
    );
});

// Página do scanner
app.get('/scanner', requireLogin, (req, res) => {
    res.render('scanner');
});

app.post('/create-user', async (req, res) => {
    const { username, password } = req.body;

    try {
        // Verificar se o usuário já existe
        const userExists = await pool.query('SELECT * FROM usuarios WHERE username = $1', [username]);
        if (userExists.rows.length > 0) {
            return res.status(400).json({ error: 'Usuário já existe' });
        }

        // Criar novo usuário
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO usuarios (username, password) VALUES ($1, $2) RETURNING id',
            [username, hashedPassword]
        );

        // Fazer login automático após criar o usuário
        req.session.userId = result.rows[0].id;
        req.session.username = username;

        res.json({ success: true, message: 'Usuário criado com sucesso', autoLogin: true });
    } catch (err) {
        console.error('Erro ao criar usuário:', err);
        res.status(500).json({ error: 'Erro ao criar usuário' });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
