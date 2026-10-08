# TweeLive

En retro MSN-meddelandeapplikation med Tweegee-tema. TweeLive kombinerar nostalgisk design med moderna realtidskommunikationsfunktioner och återvänder till internetkulturens 2000-tal genom modern teknik.

## Teknik

- **Backend:** Node.js
- **Realtidskommunikation:** Socket.io
- **Databas:** PostgreSQL (Supabase)

## Så fungerar projektet

I [dokumentation](./dokumentation/README.md) finns tio numrerade guider på
svenska: databasanslutning, inloggning och sessioner, kontakter och status,
textchatt och nudge, bilagor, skrivindikator, olästa meddelanden, emojis,
aviseringsljud samt projektstruktur och tester.

Guiderna följer projektets git-historik men beskriver den aktuella koden,
med enkla steg och exempel att prova själv.

## Laboration 2-projekt

Detta projekt är utformat för Laboration 2-workshoppen med en utvecklingsperiod på 6 veckor. Målet är att gå från grundläggande meddelandefunktionalitet till en fullt funktionell retro-chattapplikation.

**Inlämningsfrist:** Inom 6 veckor

## Installation & Setup

```bash
npm install
npm run dev
```

## Publicera en demo med Render

Projektet har en [Render Blueprint-konfiguration](./render.yaml) för en
Node.js-webbtjänst. För att publicera:

1. Pusha projektet till ett GitHub-repository.
2. Skapa en ny Blueprint på Render och anslut repositoryt.
3. Ange de fyra hemliga miljövariabler Render efterfrågar:
   `SESSION_SECRET`, `DATABASE_URL`, `SUPABASE_URL` och `SUPABASE_ANON_KEY`.
4. Generera en lång, slumpmässig `SESSION_SECRET`. Använd aldrig
   sessionsnyckeln som står i utvecklingsfallbacken.
5. Använd Supabase PostgreSQL-anslutningssträng och Supabase Storage-URL
   samt nyckel. Lägg inte dessa värden i git eller i `render.yaml`.
6. Låt Render bygga med `npm ci` och starta med `npm start`.

Render sätter `PORT`. Produktionsläget använder HTTPS-säker sessionscookie
och litar på Render-proxyn. Databasen och Storage finns redan hos Supabase.

Render Free kan pausa webbtjänsten efter inaktivitet. Första besöket efter
paus kan därför ta längre tid, och användare kan behöva logga in igen efter
omstart eftersom nuvarande express-session-store ligger i serverns minne.
För den här klassdemo-konfigurationen körs en instans; dela inte tjänsten
över flera instanser utan att först lägga till en beständig sessions-store.

## Serverstruktur

Serverdelen använder CommonJS via sin lokala [package.json](./server/package.json).
Projektets övriga JavaScript behåller sitt befintliga modulformat.

- [server/index.js](./server/index.js): Express, sessioner, statiska filer, routrar och HTTP/Socket.io-start.
- [config/env.js](./server/config/env.js): läser samma miljökonfiguration som tidigare.
- [config/db.js](./server/config/db.js): PostgreSQL-pool och databasstatus.
- [services/supabase.js](./server/services/supabase.js): Supabase Storage-klient.
- [middleware/requireAuth.js](./server/middleware/requireAuth.js): gemensam sessionskontroll.
- [routes/auth.js](./server/routes/auth.js): autentisering, registrering och användarvalidering.
- [routes/contacts.js](./server/routes/contacts.js): kontakter, sökning, presence och statusmeddelanden.
- [routes/conversations.js](./server/routes/conversations.js): konversationer, meddelanden och filuppladdning.
- [sockets/chatSocket.js](./server/sockets/chatSocket.js): socket-händelser och den gemensamma `onlineUsers`-referensen.

Meddelanden och bilagor skickas endast till deltagarnas individuella sockets.
Konversationsrummen används fortsatt för skrivindikatorn. Befintlig bucket
`chat_attachments`, API-svar och sessionsinställningar är bevarade.

Kör serverns regressionstester utan en riktig databas eller Storage-uppladdning:

```bash
node --test server/tests/modularisering.test.js
```

## 🔐 Databaskonfiguration - VIKTIGT!

### Säkerhetsvarning
**ALDRIG** commita dina databaskällor till GitHub! De innehåller lösenord och känslig information.

### Hur det fungerar

1. **`.env.example`** - Detta är en template som visas på GitHub. Den innehåller ingen känslig data, bara exempel.
2. **`.env.local`** - Detta är din lokala fil med FAKTISKA autentiseringsuppgifter. Den är `gitignored` och kommer ALDRIG att synas på GitHub.

### För nya utvecklare

Om du är ny på projektet och behöver databaskonfigurationen:

1. Fråga projektledaren (denna användare) om `.env.local` filen
2. De kommer att ge dig filen direkt (inte via GitHub!)
3. Spara den som `.env.local` i projektets rotmapp
4. Den kommer automatiskt att ignoreras av Git

### För projektledaren

För att dela databaskonfigurationen med nya teammedlemmar:

1. **ALDRIG** paste lösenord i chat eller Slack
2. **Skicka** `.env.local` filen direkt via säker kanal
3. Instruera mottagaren att placera den i projektets rotmapp
4. Bekräfta att filen är `.gitignored`

### Verifiering

För att verifiera att `.env.local` är säker:
```bash
# Denna kommando ska visa 0 träffar (filen är inte tracked)
git ls-files | grep "\.env.local"
```
