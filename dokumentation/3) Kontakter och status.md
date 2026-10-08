# 3) Kontakter, online-status och personliga statusmeddelanden

## Sök och lägg till en vän

1. [main.js](../public/js/main.js) skickar söktexten till
   `GET /api/users/search?q=...`.
2. [contacts.js](../server/routes/contacts.js) söker bland användarnamn
   och e-post, men utesluter den inloggade användaren.
3. Klick på **Lägg till** skickar `{ contactId }` till
   `POST /api/contacts/request`.
4. Servern kontrollerar att användaren finns och att relationen inte
   redan finns. Den skapar en rad i `contacts` med status `pending`.
5. Mottagarens aktiva sockets får `friend_request_received`.
   Frontend kör `loadContacts()` så att förfrågan visas utan omladdning.

I en kontaktpost är `user_id` den som skickade förfrågan och `contact_id`
den som tog emot den. Kontaktpostens `id` är alltså inte vännens användar-id.

## Acceptera, avvisa och ta bort

| Åtgärd | API-anrop | Resultat |
|---|---|---|
| Acceptera | `PUT /api/contacts/:id/accept` | Mottagaren ändrar en väntande förfrågan till `accepted`. |
| Avvisa eller ta bort | `DELETE /api/contacts/:id` | Kontaktposten tas bort om användaren är en av parterna. |
| Blockera, befintlig API-rutt | `PUT /api/contacts/:id/block` | Relationens status blir `blocked`. |

Efter accept får båda parterna `friend_request_accepted`.
Efter borttagning får båda `contact_removed`.
Frontend laddar om listan och stänger den aktiva chatten om kontakten togs bort.

`GET /api/contacts` returnerar `friends`, `pendingRequests` och `blocked`.
Godkända vänner hämtas i båda riktningarna, oavsett vem som skickade förfrågan.
Borttagningen raderar inte konversationens gamla meddelanden.

## Hur online-status fungerar

[chatSocket.js](../server/sockets/chatSocket.js) har en `onlineUsers`-Map:
användar-id → en mängd socket-id:n. Varje flik kan ha en egen socket.

När den första socketen registreras med `user_connected` skickas
`user_status_change` med `online`. När sista socketen försvinner skickas
`offline`. Att stänga en av två flikar gör därför inte användaren offline.

`GET /api/users/online` ger startläget när kontaktlistan laddas.
Socket-händelser uppdaterar sedan cirklarna i realtid.
Online-status är tillfällig information i serverminnet, inte en databaspost.

## Personligt statusmeddelande

Detta är texten som visas bredvid användarnamnet, inte online-cirkeln.
När statusfältet lämnas, eller Enter trycks, skickar frontend
`PUT /api/users/status-message`.

Servern tar bort blanksteg i början/slutet, begränsar texten till 120 tecken,
sparar `users.status_message` och uppdaterar sessionen.
`user_status_message_change` skickas till anslutna klienter. Frontend
uppdaterar kontaktlistan och den aktiva chattens header.
En tom sträng tar bort statusmeddelandet.

**Prova:** använd två inloggningar, skicka en förfrågan, acceptera den
och ändra statusmeddelandet. Öppna sedan en extra flik och stäng bara den
ena för att se hur online-status fungerar.

**Git-bakgrund:** steg 5–6 (`26fadf7`, `09354de`), steg 9 (`8c55329`),
steg 11 (`6d331e4`) och steg 13 (`74bd114`).

[Till innehållsförteckningen](./README.md)
