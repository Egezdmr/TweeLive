# 4) Chatt 1: textmeddelanden och nudge

## Öppna en konversation

När en kontakt klickas kör [chat.js](../public/js/chat.js) `openChatWith()`.
Den valda användaren sparas i `activeChatUser`.

Frontend skickar `{ recipientId }` till `POST /api/conversations`.
[conversations.js](../server/routes/conversations.js) letar efter en
gemensam konversation. Finns den återanvänds dess id. Annars skapas en
konversation och två deltagarposter i en transaktion.

En **transaktion** innebär att de nya databasposterna sparas tillsammans.
Vid fel försöker servern rulla tillbaka arbetet.

Frontend går med i socket-rummet `conv_<id>` och hämtar historiken via
`GET /api/conversations/:id/messages`.
Servern kontrollerar att den inloggade användaren är deltagare.
Frågan sorterar i stigande datumordning och tar högst 50 meddelanden:
det är de första 50 i den ordningen, inte de senaste 50.

## Skicka vanlig text

1. Användaren skriver text och klickar **Skicka**.
2. Frontend skickar `{ content, messageType: 'text' }` med POST till
   `/api/conversations/:id/messages`.
3. Servern kontrollerar att texten inte är tom och att användaren deltar.
4. Meddelandet sparas i `messages`. Avsändaren tas från sessionen.
5. Servern hittar deltagarnas aktiva sockets och skickar `new_message`.
6. Frontend visar meddelandet om konversationen är aktiv. Annars kan
   unread-räknaren öka, se [guide 7](<./7) Olasta meddelanden.md>).

HTTP-anropet sparar meddelandet. Socket-händelsen visar det i realtid.
Frontend lägger alltså inte till samma meddelande en gång från HTTP-svaret
och en gång från socketen.

Utskicket går **bara till individuella deltagarsockets**, inte även till
konversationsrummet. Det undviker dubbla utskick och gör att en inloggad
mottagare kan få meddelandet även utan att först öppna chatten.

## Nudge / Titresha

Knappen **Titresha** använder samma meddelande-API, men skickar
`messageType: 'nudge'`. Nudgen sparas därför också i historiken.

`appendMessageBubble()` visar en centrerad nudge-text med tidsstämpel.
För nya live-händelser sätts `isLive` till `true` och chattområdet skakar
med CSS-animationen `nudge-shake`. Historiska nudges visas utan skakning.
En nudge från någon annan spelar också sitt särskilda aviseringsljud.

Vanlig text visas under avsändarraden, med tid formaterad via `sv-SE`.
Tiden följer webbläsarens tidszon; språkinställningen tvingar inte svensk tidszon.

**Prova:** skicka text och en nudge mellan två användare. Öppna sedan
chatten igen: båda ska finnas i historiken, men den gamla nudgen ska inte skaka.

**Git-bakgrund:** `50e434e` (steg 7, meddelanden), `3136af7`
(steg 8, Socket.io) och `16e7457` (nudge-felsökning).

[Till innehållsförteckningen](./README.md)
