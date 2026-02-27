# O Impostor (HTML, CSS, JS)

Jogo multiplayer em tempo real usando Firebase Realtime Database + Firebase Auth anonimo.

## Stack

- HTML
- CSS
- JavaScript (ES Modules)
- Firebase Realtime Database
- Firebase Authentication (anonimo)

## Rodar no VS Code

Opcao 1 (recomendada): extensao **Live Server**
1. Abra a pasta no VS Code.
2. Clique com o botao direito em `index.html`.
3. Selecione `Open with Live Server`.

Opcao 2 (terminal):
```bash
npm run dev
```

## Configuracao Firebase

1. No Firebase Console, habilite:
- Realtime Database
- Authentication > Sign-in method > Anonymous

2. Realtime Database > Rules:
- Cole o conteudo de `database.rules.json`.

3. Se precisar trocar projeto Firebase, edite `firebase-config.js`.

## Deploy no GitHub + Vercel

1. Suba para o GitHub normalmente.
2. No Vercel:
- Import Project (repo)
- Framework Preset: `Other`
- Build Command: vazio
- Output Directory: vazio

O arquivo `vercel.json` ja aplica rewrite para `index.html`.

## Deploy no Firebase Hosting

```bash
firebase login
firebase use --add
firebase deploy
```

## Melhorias de seguranca e consistencia aplicadas

- Regras de leitura/escrita restritas a jogadores autenticados da sala.
- Autenticacao anonima obrigatoria.
- Entrada em sala com transacao atomica (evita ultrapassar 8 jogadores).
- Criacao de sala com prevencao de colisao de codigo.
- Acoes criticas bloqueadas para nao-host (cliente + regras).
- `onDisconnect()` para remover jogador desconectado automaticamente.
- Recuperacao de host quando o anfitriao sai inesperadamente.
