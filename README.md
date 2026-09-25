# Nilma Entregas

## Versão de teste

**Link de teste:** https://nilmaadvancedsystems.github.io/Entregas/teste/entregas.html

**Para testar sem gravar nada no banco:** https://nilmaadvancedsystems.github.io/Entregas/teste/entregas.html?demo=1

### O que não mudou

- O sistema do escritório ([…/Entregas/entregas.html](https://nilmaadvancedsystems.github.io/Entregas/entregas.html)) continua **exatamente** como está, na versão de 24/09 às 17:54. Nenhum arquivo dele foi alterado: tudo o que é de teste fica dentro da pasta `teste/`.
- **O banco não foi tocado.** As regras de permissão foram só lidas, sem gravar nada, e estão normais.

### Sobre o bug de login e permissão

- Entre a versão de 24/09 às 17:54 e as mais novas, **nenhuma linha de código de login, permissão ou conexão com o banco mudou**. As regras que estão no ar no Firebase também se comportam normalmente.
- A causa mais provável é a **sessão de login no Safari**: o sistema tentou ler o banco sem que o login estivesse valendo.
- Para confirmar, no link de teste:
  1. Abra o link no Safari.
  2. Se aparecer "Sem permissão", abra o menu ☰, toque em **Sair da conta** e entre de novo com nome e senha.
  3. Se não funcionar, tire um print da tela inteira, com a barra de cima.

### Como trabalhamos

- As mudanças pedidas são feitas no branch [`teste`](https://github.com/nilmaadvancedsystems/Entregas/tree/teste) e copiadas para a pasta `teste/`, para conferir no link de teste.
- O sistema do escritório só muda quando for dito **"pode colocar no ar"**.

---

## Sistema do escritório

Entregador de Entregas (Nilma Entregas)
https://nilmaadvancedsystems.github.io/Entregas/entregas.html
