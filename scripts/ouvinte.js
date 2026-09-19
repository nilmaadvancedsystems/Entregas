// Ouvinte do Firestore que volta sozinho.
//
// Quando um onSnapshot dá erro (rede caiu, cota do dia estourou), o Firestore
// encerra aquele ouvinte e não tenta de novo. Os módulos só registravam o erro,
// e a função ficava morta até alguém reiniciar o vigia — sem ninguém saber.
// Aqui o ouvinte é refeito com espera crescente: 30s, 1min, 2min... até 30min.
function ouvir(nome, consulta, aoChegar, log) {
  let espera = 30000;
  let parar = null;
  let encerrado = false;
  const ligar = () => {
    if (encerrado) return;
    parar = consulta().onSnapshot(snap => {
      espera = 30000;                       // chegou dado: a próxima queda começa do zero
      try { aoChegar(snap); } catch (err) { log(nome + ': erro tratando os dados -', err.message); }
    }, err => {
      log(nome + ': perdi o ouvinte (' + err.message + '); tento de novo em ' + Math.round(espera / 1000) + 's');
      setTimeout(ligar, espera);
      espera = Math.min(espera * 2, 30 * 60 * 1000);
    });
  };
  ligar();
  return () => { encerrado = true; if (parar) parar(); };
}

module.exports = { ouvir };
