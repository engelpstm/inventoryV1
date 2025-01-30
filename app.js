const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const QRCode = require('qrcode');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();

// Configuração do EJS como view engine
app.set('view engine', 'ejs');

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
    user: 'postgres',
    host: 'localhost',
    database: 'inventario',
    password: '123456',
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

// Criar tabelas se não existirem
const createTables = [
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
        if (err) throw err;
    });
});
console.log('Tabelas criadas ou já existentes');

// Rotas
// Página inicial - Lista todos os bens
app.get('/', (req, res) => {
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
app.post('/adicionar', upload.single('imagem'), (req, res) => {
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
app.get('/editar/:id', (req, res) => {
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
app.post('/atualizar/:id', (req, res) => {
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
app.get('/excluir/:id', (req, res) => {
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
app.get('/api/localizacoes', (req, res) => {
    pool.query('SELECT * FROM localizacoes ORDER BY nome', (err, results) => {
        if (err) {
            res.status(500).send('Erro ao buscar localizações');
            return;
        }
        res.json(results.rows);
    });
});

app.post('/api/localizacoes', (req, res) => {
    const { nome } = req.body;
    
    // Validar se o nome foi fornecido e não está vazio
    if (!nome || !nome.trim()) {
        res.status(400).send('O nome da localização é obrigatório');
        return;
    }

    // Remover espaços extras e normalizar o nome
    const nomeNormalizado = nome.trim();

    pool.query(
        'INSERT INTO localizacoes (nome) VALUES ($1)',
        [nomeNormalizado],
        (err, result) => {
            if (err) {
                console.error('Erro ao inserir localização:', err);
                if (err.code === '23505') {
                    res.status(400).send('Esta localização já existe');
                    return;
                }
                res.status(500).send('Erro ao cadastrar localização. Por favor, tente novamente.');
                return;
            }
            res.json({ id: result.rows[0].id, nome: nomeNormalizado });
        }
    );
});

app.put('/api/localizacoes/:id', (req, res) => {
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

app.delete('/api/localizacoes/:id', (req, res) => {
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
app.get('/qrcode', (req, res) => {
    res.render('qrcode');
});

// API para buscar bem por ID e gerar QR Code
app.get('/api/bem/:id', async (req, res) => {
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
app.post('/gerar-qrcode/:id', async (req, res) => {
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

// Visualizar bem específico
app.get('/bem/:id', (req, res) => {
    pool.query(
        `SELECT b.*, l.nome as localizacao_nome 
         FROM bens b 
         JOIN localizacoes l ON b.localizacao_id = l.id 
         WHERE b.id = $1`,
        [req.params.id],
        (err, results) => {
            if (err) {
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
app.get('/scanner', (req, res) => {
    res.render('scanner');
});

// Verificar se um bem existe
app.get('/verificar-bem/:id', (req, res) => {
    pool.query(
        'SELECT id FROM bens WHERE id = $1',
        [req.params.id],
        (err, results) => {
            if (err) {
                res.status(500).json({ error: 'Erro ao verificar bem' });
                return;
            }
            res.json({ exists: results.rows.length > 0 });
        }
    );
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
