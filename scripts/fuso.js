// O fuso do escritório, dito em voz alta.
//
// Nove rotinas decidem QUANDO agir olhando a hora local: "resumo a partir das
// 18h", "lembrete a partir das 8h", "backup entre 12h e 20h", "sexta depois das
// 17h". No PC do escritório isso funciona por acidente — o Windows está em
// UTC-3 e ninguém precisou pensar no assunto.
//
// Servidor do Google roda em UTC. Sem esta linha, o resumo das 18h sairia às
// 15h de Brasília, o lembrete das 8h às 5h da manhã, e a "sexta" viraria
// quinta-feira à noite. É o tipo de erro que não quebra nada, não aparece em
// teste nenhum e só é descoberto quando um cliente recebe e-mail de madrugada.
//
// Quem já tiver TZ definido (alguém que sabe o que está fazendo, ou o próprio
// ambiente de produção) manda; esta é só a rede de segurança.
if (!process.env.TZ) process.env.TZ = 'America/Sao_Paulo';

module.exports = { FUSO: process.env.TZ };
