# 1) Databasanslutning

## Grundidén

TweeLive sparar användare, kontakter och meddelanden i PostgreSQL hos
Supabase. Webbläsaren ansluter inte direkt till databasen. Den skickar ett
API-anrop till servern, som gör SQL-frågan och skickar tillbaka ett svar.

`Webbläsare → Express-server → PostgreSQL → svar till webbläsaren`

## Så skapas anslutningen

1. [env.js](../server/config/env.js) läser först miljövariabler från
   `security/.env.local` och därefter från den vanliga `.env`-filen.
   Redan satta värden skrivs inte över av standardinställningen i dotenv.
2. [db.js](../server/config/db.js) använder `DATABASE_URL` när en
   `pg.Pool` skapas. Variabeln innehåller databasens anslutningsuppgifter.
3. Poolen delas med routrarna. De behöver därför inte skapa egna pooler.
4. Vid start kör servern `SELECT NOW()` för att kontrollera anslutningen.

En **pool** är en samling databasanslutningar som kan återanvändas.
Tänk på den som ett antal öppna kassor: flera förfrågningar kan hanteras
utan att en helt ny anslutning behöver skapas varje gång.

Vanliga frågor använder `pool.query()`. När flera frågor ska ingå i samma
transaktion används `pool.connect()`, och anslutningen lämnas tillbaka
med `client.release()` när arbetet är klart.

## Vad lagras?

| Tabell | Innehåll |
|---|---|
| `users` | Användare, lösenordshash och personligt statusmeddelande. |
| `contacts` | Vänförfrågningar och relationernas status. |
| `conversations` | Själva konversationerna. |
| `conversation_participants` | Vilka användare som deltar i en konversation. |
| `messages` | Text, nudge och länkar till bilagor. |

SQL använder platshållare som `$1` och `$2`. Värden skickas separat,
så användarens text inte behöver klistras in direkt i SQL-strängen.

## Kontroll och konfiguration

Starta servern och öppna `/api/status`. Fältet `database` visar serverns
anslutningsstatus, till exempel `connected`. Det är inte en ny databaskontroll
vid varje anrop, utan den status servern senast har registrerat.

Databastabellerna måste redan finnas. Serverstarten kör inte automatiskt
hela [migration.sql](../database/migration.sql). Den filen visar grundschemat,
men dess gamla `message_type`-regel innehåller bara `text` och `nudge`.
En ny databas behöver även stöd för `image`, `audio` och `status_message`
för att motsvara den nuvarande applikationen.

Lägg aldrig riktiga anslutningsuppgifter i dokumentation eller git.

**Git-bakgrund:** `0900176` (steg 2.1, databasanslutning) och
`e1b5cb1` (steg 4, databasdesign).

[Till innehållsförteckningen](./README.md)
