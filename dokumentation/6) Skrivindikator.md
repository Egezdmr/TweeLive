# 6) Skrivindikator: ”användaren skriver”

## Grundidén

Skrivindikatorn visar att motparten håller på att skriva.
Den skickar inte själva utkastet och sparas inte i databasen.

Den ska inte förväxlas med det personliga statusmeddelandet
som visas bredvid användarnamnet.

## Så går signalen genom systemet

1. Ett `input`-event på meddelandefältet upptäcker att texten ändras.
2. Om text finns och en konversation är vald skickar
   [chat.js](../public/js/chat.js) `typing_start` med
   `{ conversationId, username }`.
3. [chatSocket.js](../server/sockets/chatSocket.js) skickar vidare
   `user_typing` till **andra sockets** i rummet `conv_<id>`.
4. Mottagarens frontend visar exempelvis
   **”Anna skriver ett meddelande...”**.
5. När `typing_stop` skickas vidare som `user_stop_typing` döljs texten.

`socket.to(...).emit(...)` utesluter den socket som skickade signalen.
Man ska alltså inte se sin egen skrivindikator.

## Varför en timer?

Efter varje ändring återställs en timer på **2 500 millisekunder**.
Om inget nytt skrivs under den tiden skickas `typing_stop`.
Detta kallas ofta debounce: vi väntar tills aktiviteten har pausat.

Frontend skickar också stopp när fältet töms och vid meddelandesändning
om skrivtimern finns. Vid chattbyte eller stängning rensas den lokala
timern och den synliga indikatorn.

Stoppet bygger på avsändarens timer och socket-händelser. Det finns
inte en separat säkerhetstimer hos mottagaren som döljer texten om en
stoppsignal aldrig når fram.

## Varför används ett rum?

När en chatt öppnas skickas `join_conversation`, och socketen går med
i `conv_<id>`. Skrivstatus behöver bara nå andra i samma rum.
Vanliga meddelanden levereras däremot direkt till användarnas sockets,
så att även olästa meddelanden från en oöppnad chatt kan tas emot.

**Prova:** öppna samma konversation med två användare, skriv några tecken
utan att skicka och vänta ungefär 2,5 sekunder.

**Git-bakgrund:** `362e3be` (steg 10, typing status).

[Till innehållsförteckningen](./README.md)
