# HARiges — Monitoramento de Energia

Dashboard web independente para acompanhar medidores Tuya Local/Tuya Cloud expostos pelo Home Assistant. Cada usuário vê somente os setores autorizados.

## Como iniciar

1. No Home Assistant, abra seu perfil e crie um **token de acesso de longa duração**.
2. Copie `.env.example` para `.env` e preencha `HA_TOKEN`, `APP_ADMIN_PASSWORD` e `SESSION_SECRET`.
3. Entre na pasta `hariges_energy`, execute `node server.js` e acesse `http://localhost:3000`.

Não há dependências externas: basta Node.js 20 ou superior. Na primeira execução, o usuário administrador é criado a partir das variáveis `APP_ADMIN_USER` e `APP_ADMIN_PASSWORD`. Remova essas duas variáveis depois do primeiro acesso ou mantenha uma senha forte.

## Setores iniciais

- DTI — `sensor.geral_sala_tecnica_dti_*`
- COPE — `sensor.cope_energy_meter_*`
- EMGETIS — `sensor.geral_sala_tecnica_emgetis_*`

O administrador pode criar usuários e liberar um ou mais setores em **Acessos**. A configuração fica em `data/runtime.json`; senhas são armazenadas com `scrypt`, nunca em texto puro.

## Produção

Sirva atrás de HTTPS (Caddy, Nginx ou proxy do Home Assistant) e defina `COOKIE_SECURE=true`. O navegador nunca recebe o token do Home Assistant: todas as consultas passam pelo backend.

## Dashboard nativo no Home Assistant

O painel Lovelace **Energia — Setores** pode ser criado ou atualizado diretamente no Home Assistant, a partir da raiz do repositório, com:

```powershell
.\scripts\install-ha-dashboard.ps1
```

O instalador lê `HA_URL` e `HA_TOKEN` do `.env`, preserva os demais dashboards e mantém três abas: DTI, COPE e EMGETIS. Ao ser executado novamente, atualiza somente o painel `energia-setores`.

## Add-on independente para clientes

O projeto também é um add-on local do Home Assistant. Ele publica a interface própria na porta `8099`, usa a API interna do Supervisor e não mostra a interface do Home Assistant ao cliente.

### Instalação pelo GitHub

1. No Home Assistant, abra **Configurações → Complementos → Loja de complementos**.
2. No menu superior, escolha **Repositórios** e adicione `https://github.com/leonesmoura/ha-energy-dashboard`.
3. Instale **HARiges Energia**, inicie o add-on e ative **Iniciar na inicialização**.
4. Acesse `http://IP_DO_HOME_ASSISTANT:8099` e crie o administrador no primeiro acesso.

Também é possível copiar a pasta `hariges_energy` diretamente para `/addons` usando Samba ou SSH.

O banco de usuários fica em `/data/runtime.json`, área persistente do add-on. O token de Supervisor nunca é enviado ao navegador.
