# Ativar o banco online e o WhatsApp no Sistema V

O código já está pronto. Falta só criar as contas e copiar algumas chaves.
Faça na ordem. Tudo é **grátis**, menos mensagens que **você** inicia no WhatsApp (respostas em até 24h depois do cliente escrever não são cobradas).

Comece com **1 número de teste**. Os outros 4 continuam no celular até tudo funcionar.

> ⚠️ O número ligado à API **sai do app WhatsApp do celular**. Antes, faça backup das conversas dele (WhatsApp → Configurações → Conversas → Backup).

---

## 1. Supabase (banco de dados e login)

1. Entre em **supabase.com** → *New project*. Nome: `sistema-v`. Região: **West EU (Ireland)**. Guarde a senha do banco.
2. Menu **SQL Editor** → *New query* → cole todo o arquivo `supabase/schema.sql` → **Run**.
3. Menu **Authentication → Users → Add user → Create new user**: seu e-mail e uma senha forte. Marque *Auto confirm user*.
   **Importante:** em **Authentication → Sign In / Providers**, **desligue "Allow new users to sign up"**. Assim só entra quem você cadastrar.
4. Menu **Project Settings → API** e copie:
   - **Project URL** → vai virar `SUPABASE_URL`
   - **anon public** → `SUPABASE_ANON_KEY`
   - **service_role** → `SUPABASE_SERVICE_ROLE_KEY` (secreta: nunca mande para ninguém)

## 2. Netlify (onde o Sistema V fica no ar)

1. No projeto do Sistema V: **Project configuration → Build & deploy → Link repository** → escolha `sistemav`.
   (Sem isso as funções do WhatsApp não sobem.)
2. **Project configuration → Environment variables → Add a variable**, uma por uma:

| Nome | Valor |
|---|---|
| `SUPABASE_URL` | Project URL do passo 1 |
| `SUPABASE_ANON_KEY` | chave anon |
| `SUPABASE_SERVICE_ROLE_KEY` | chave service_role |
| `WA_VERIFY_TOKEN` | invente uma senha (ex.: `sistemaV-2026-verde`) |
| `WA_APP_SECRET` | do passo 3.4 |
| `WA_TOKEN` | do passo 3.5 |

3. **Deploys → Trigger deploy → Deploy site**.

A partir daqui o Sistema V já pede login e grava no banco online, mesmo antes do WhatsApp.

## 3. Meta (WhatsApp Cloud API)

1. **business.facebook.com** → crie o portfólio da empresa **3TREE UNIVERSE PUBLICIDADE E SERVIÇOS LTDA** (nome, endereço, site 3treeuniverse.com).
2. **developers.facebook.com** → *My Apps → Create app* → tipo **Business** → ligue ao portfólio → adicione o produto **WhatsApp**.
3. Em **WhatsApp → API Setup → Add phone number**: cadastre o número de teste e confirme o código por SMS. Copie o **Phone number ID**.
4. **App settings → Basic → App secret** → *Show* → copie para `WA_APP_SECRET` no Netlify.
5. Token permanente: **business.facebook.com → Configurações → Usuários do sistema → Adicionar** (Admin) → *Gerar token* para o seu app, com as permissões `whatsapp_business_messaging` e `whatsapp_business_management`, validade **Nunca**. Copie para `WA_TOKEN` no Netlify.
6. **WhatsApp → Configuration → Webhook → Edit**:
   - Callback URL: `https://ENDERECO-DO-SISTEMA-V.netlify.app/.netlify/functions/whatsapp-webhook`
   - Verify token: o mesmo `WA_VERIFY_TOKEN`
   - Depois de salvar, em *Webhook fields* assine **messages**.
7. Depois de mudar variáveis no Netlify, faça **Trigger deploy** de novo.

## 4. Cadastrar o número no Sistema V

Supabase → **Table Editor → wa_numeros → Insert row**:

| coluna | exemplo |
|---|---|
| `phone_number_id` | o Phone number ID da Meta |
| `rotulo` | `Triuniverse Travel` |
| `telefone` | `+353 89 264 3202` |
| `ativo` | true |
| `auto_resposta` | (opcional) texto próprio; use `{protocolo}` onde entra o número |

## 5. Primeiro acesso

1. Abra o Sistema V → entre com o e-mail e a senha do passo 1.3.
2. Em *Primeiro acesso*, crie o Administrador geral com **o mesmo e-mail**. Nas próximas vezes você entra direto.
3. Para **responder clientes**, dê a si mesmo também o papel **Supervisor** ou **SAC** (menu **Equipe/RH**). O papel Administrador geral só configura.
4. Para trazer o que você já tinha na prévia: abra o Sistema V **no mesmo navegador que usava antes** → menu **WhatsApp** → *Importar dados da prévia deste navegador*.

## 6. Testar

De outro celular, mande "oi" para o número de teste. Em segundos:
- chega a resposta automática com o protocolo **3TU-…**;
- a conversa aparece no menu **WhatsApp** do Sistema V, com bolinha vermelha;
- abra, vá em **Chat com cliente**, responda: a mensagem sai pelo mesmo número.

Funcionou? Repita os passos 3.3 e 4 para cada um dos outros números.

---

### Como funciona por dentro
- `netlify/functions/whatsapp-webhook.mjs` — recebe as mensagens, cria cliente e protocolo 3TU (ou junta ao protocolo aberto), responde automaticamente.
- `netlify/functions/whatsapp-enviar.mjs` — envia as respostas da equipe pelo número certo (só com login).
- `netlify/functions/config.mjs` — passa ao navegador o endereço do Supabase (nunca a chave secreta).
- Protocolo **encerrado/resolvido** + cliente escreve de novo = **protocolo novo**.
- Fotos, áudios e documentos aparecem como `[imagem]`, `[áudio]`… (o arquivo fica no celular de quem mandou).
- Regra do WhatsApp: texto livre só até **24h** depois da última mensagem do cliente.
