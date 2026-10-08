# 2) Inloggning, registrering och sessioner

## Registrering

1. Användaren fyller i registreringsformuläret.
2. [main.js](../public/js/main.js) kontrollerar bland annat e-postformat
   och att de två lösenorden matchar. Användarnamn och e-post kontrolleras
   också via `/api/check-username/:username` och `/api/check-email/:email`.
3. Formuläret skickas till `POST /api/register`.
4. [auth.js](../server/routes/auth.js) kontrollerar obligatoriska fält och
   om användarnamn eller e-post redan finns.
5. [passwordUtils.js](../security/passwordUtils.js) skapar en bcrypt-hash
   med 10 salt-rundor. Hashen sparas i stället för det vanliga lösenordet.

En **hash** är inte ett krypterat lösenord som servern senare låser upp.
Vid inloggning använder bcrypt det inskrivna lösenordet för att kontrollera
om det stämmer med den sparade hashen.

Registreringen loggar inte automatiskt in användaren.
Frontendens kontroller hjälper användaren, men ersätter inte serverkontroller.
Den äldre testvägen `POST /api/users` finns också kvar; det vanliga
registreringsformuläret använder `/api/register` och bcrypt.

## Inloggning

`POST /api/login` tar emot `{ identifier, password }`.
Identifieraren kan vara användarnamn eller e-post.

Servern hämtar användaren och kontrollerar lösenordet med bcrypt.
Vid rätt lösenord sparas `id`, `username`, `email` och `status_message`
i `req.session.user`. Frontend får ett JSON-svar och visar chattvyn.
Den registrerar också användarens socket med `user_connected`.

## Hur sessionen håller oss inloggade

[index.js](../server/index.js) använder `express-session`.
Webbläsaren får en cookie som heter `connect.sid`. Den identifierar sessionen;
själva användaruppgifterna ligger på servern.

- Cookien har `httpOnly`, så sidans JavaScript inte kan läsa den.
- Livslängden är satt till 24 timmar.
- `secure` är för närvarande `false` för den lokala HTTP-miljön.
- Ingen separat sessionslagring är konfigurerad: sessionerna finns i
  serverns minne och försvinner när serverprocessen startas om.

Vid sidladdning frågar frontend `GET /api/auth/me` vem som är inloggad.
Skyddade API-rutter använder [requireAuth.js](../server/middleware/requireAuth.js).
Saknas sessionens användare svarar de med `401`.

`credentials: 'include'` i frontendens fetch-anrop gör att cookies kan
skickas med. `sessionStorage` används också för personligt statusmeddelande,
men är inte det som ger användaren behörighet.

## Utloggning och ett enkelt test

`POST /api/auth/logout` förstör sessionen och tar bort cookien.
Frontend kopplar från och återansluter sin socket, tömmer unread-räknarna
och visar inloggningsvyn.

Prova att logga in, ladda om sidan och sedan logga ut. Omladdningen ska
behålla inloggningen så länge sessionen fortfarande är giltig.

**Git-bakgrund:** `dc4b59c` (inloggning), `64c13b9` (registrering),
`0c065cf` (bcrypt) och `843ce90` (sessioner).

[Till innehållsförteckningen](./README.md)
