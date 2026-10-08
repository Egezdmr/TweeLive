# 7) Olästa meddelanden

## Vad räknar märket?

Den orange brickan i kontaktlistan visar hur många inkommande meddelanden
som har tagits emot medan just den konversationen inte var öppen.

[chat.js](../public/js/chat.js) håller räknarna i `unreadCounts`.
Nyckeln är avsändarens användar-id, inte kontaktpostens id.

## När `new_message` kommer

1. Frontend jämför meddelandets `conversation_id` med den aktiva chatten.
2. Är chatten aktiv visas meddelandet direkt och listan scrollas ned.
3. Är den inte aktiv, och avsändaren är någon annan, ökas den personens räknare.
4. `updateUnreadBadgeUI()` visar rätt antal vid kontakten.
5. Egna skickade meddelanden ökar inte räknaren.

Samma flöde används även för nudge och bilagor eftersom de också
levereras som `new_message`.

När kontaktlistan byggs om använder `displayFriends()` de befintliga
räknarna. Märket försvinner därför inte bara för att listan laddas om.

## När nollställs räknaren?

När användaren klickar på kontakten och `openChatWith()` körs sätts
kontaktens räknare till noll direkt. Vid lyckad utloggning töms hela objektet.

Räknarna finns bara i den aktuella sidans minne:

- En sidomladdning tömmer dem.
- Olika flikar har egna räknare.
- Det finns ingen sparad lässtatus i databasen.
- Meddelanden som skickades medan användaren var frånkopplad räknas inte
  automatiskt som olästa vid nästa inloggning, men kan finnas i historiken.

## Varför behövdes en fix efter omladdning?

Tidigare kunde live-meddelanden utebli om mottagaren ännu inte hade
gått med i konversationsrummet. Servern skickar nu meddelandet till
alla deltagarnas registrerade sockets via `onlineUsers`.

Efter att sidan registrerat sin socket med `user_connected` kan nya
meddelanden därför tas emot utan att chatten först behöver öppnas.
Detta återställer inte gamla räknare; det gör nya live-händelser möjliga.

**Prova:** välj ingen chatt och låt en vän skicka två meddelanden.
Brickan ska visa 2. Klicka på vännen: brickan ska döljas.

**Git-bakgrund:** `9ed14a2` (steg 12), `74bd114` (steg 13) och
`a4a563d` (steg 13.1, buggrättning).

[Till innehållsförteckningen](./README.md)
