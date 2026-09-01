# TweeLive

En retro MSN-meddelandeapplikation med Tweegee-tema. TweeLive kombinerar nostalgisk design med moderna realtidskommunikationsfunktioner och återvänder till internetkulturens 2000-tal genom modern teknik.

## Teknik

- **Backend:** Node.js
- **Realtidskommunikation:** Socket.io
- **Databas:** PostgreSQL (Supabase)

## Laboration 2-projekt

Detta projekt är utformat för Laboration 2-workshoppen med en utvecklingsperiod på 6 veckor. Målet är att gå från grundläggande meddelandefunktionalitet till en fullt funktionell retro-chattapplikation.

**Inlämningsfrist:** Inom 6 veckor

## Installation & Setup

```bash
npm install
npm run dev
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

