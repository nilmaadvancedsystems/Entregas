-- Nilma Entregas — esquema do banco (MariaDB/MySQL)
-- Rode isto uma vez no phpMyAdmin do seu banco (aba "SQL", cole tudo e execute).

CREATE TABLE IF NOT EXISTS clientes (
  id VARCHAR(64) PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  nome_fantasia VARCHAR(255) NOT NULL DEFAULT '',
  documento VARCHAR(32) NOT NULL DEFAULT '',
  inscricao_estadual VARCHAR(64) NOT NULL DEFAULT '',
  telefone VARCHAR(32) NOT NULL DEFAULT '',
  enquadramento VARCHAR(32) NOT NULL DEFAULT '',
  codigo_origem VARCHAR(32) NOT NULL DEFAULT '',
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_nome (nome),
  INDEX idx_codigo (codigo_origem)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS entregas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id VARCHAR(64) NOT NULL,
  cliente_nome VARCHAR(255) NOT NULL,
  competencia VARCHAR(7) NOT NULL,
  itens JSON NOT NULL,
  recebedor VARCHAR(255) NOT NULL DEFAULT '',
  assinatura LONGTEXT NULL,
  foto LONGTEXT NULL,
  geo_lat DECIMAL(10,7) NULL,
  geo_lng DECIMAL(10,7) NULL,
  status ENUM('pendente','confirmada') NOT NULL DEFAULT 'pendente',
  criado_em DATETIME NOT NULL,
  confirmado_em DATETIME NULL,
  INDEX idx_cliente (cliente_id),
  INDEX idx_competencia (competencia),
  INDEX idx_status (status),
  CONSTRAINT fk_entrega_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  senha_hash VARCHAR(255) NOT NULL,
  nome VARCHAR(255) NOT NULL DEFAULT '',
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tokens (
  token VARCHAR(64) PRIMARY KEY,
  usuario_id INT NOT NULL,
  expira_em DATETIME NOT NULL,
  CONSTRAINT fk_token_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
