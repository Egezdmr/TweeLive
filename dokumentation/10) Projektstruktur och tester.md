# 10) Projektstruktur och tester

## Varför dela upp koden?

Tidigare låg mycket frontend-kod i en HTML-fil och mycket backend-kod
i en serverfil. Nu ligger närliggande funktioner tillsammans.
Det gör det lättare att hitta koden utan att ändra vad användaren kan göra.

## Frontend

| Fil | Ansvar |
|---|---|
| [index.html](../public/index.html) | Sidans struktur och laddning av CSS/skript. |
| [style.css](../public/css/style.css) | Den styling som tidigare låg i `<style>`; inline-stilar finns också kvar. |
| [audio.js](../public/js/audio.js) | Ljudmotor och aviseringsljud. |
| [emojis.js](../public/js/emojis.js) | Emoji-bilder, textparser och picker. |
| [chat.js](../public/js/chat.js) | Socket-händelser, aktiv chatt, historik, meddelanden och uppladdning. |
| [main.js](../public/js/main.js) | Inloggning, formulär, kontaktåtgärder och statusfält. |

Skripten använder `defer` och laddas i ordningen:
Socket.io → audio → emojis → chat → main.
`defer` betyder att skripten körs efter att HTML-strukturen har lästs,
i den ordning de står i dokumentet.

Det är vanliga skript med ett gemensamt globalt scope, inte separata
ES-moduler. Därför kan exempelvis HTML-knappar fortfarande anropa
`performLogout()` och `switchTab()`.

## Backend

[server/index.js](../server/index.js) kopplar ihop Express, sessioner,
statiska filer, routrar och Socket.io.

- [config/db.js](../server/config/db.js): en gemensam databas-pool.
- [config/env.js](../server/config/env.js): miljövariabler.
- [services/supabase.js](../server/services/supabase.js): Storage-klienten.
- [routes/auth.js](../server/routes/auth.js): autentisering.
- [routes/contacts.js](../server/routes/contacts.js): kontaktfunktioner.
- [routes/conversations.js](../server/routes/conversations.js): chatt och filer.
- [middleware/requireAuth.js](../server/middleware/requireAuth.js): sessionskontroll.
- [sockets/chatSocket.js](../server/sockets/chatSocket.js): socket-händelser och presence.

Serverns lokala [package.json](../server/package.json) anger CommonJS:
moduler använder `require` och `module.exports`.
Lösenordshjälparna behåller sitt tidigare ES-modulformat och laddas med
dynamisk import.

Routrarna får samma `io` och samma `onlineUsers`-Map.
Det är viktigt: en ny separat Map i varje fil skulle göra att en rutt
inte hittar de sockets som registrerats i socket-modulen.

## Tester och utveckling

Starta projektet från rotmappen med `npm run dev`.
Kör backendens regressionstester med:

```powershell
node --test server\tests\modularisering.test.js
```

[Testfilen](../server/tests/modularisering.test.js) kontrollerar bland annat
sessioner, API-svar, kontakt-events, konversationer och ett utskick per
deltagarsocket. Den använder simulerad databas och Storage, så testbilagor
inte laddas upp till det riktiga molnet.

Ett godkänt test med simulerade tjänster ersätter inte en kontroll av
riktiga databasinställningar eller Storage-behörigheter.

**Git-bakgrund:** uppdelningen gjordes efter funktionsstegen 2–16.
Guiderna hänvisar därför till de nya filerna, även när äldre commits
har motsvarande kod i de gamla stora filerna.

[Till innehållsförteckningen](./README.md)
