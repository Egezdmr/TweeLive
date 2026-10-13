# 11) Konferenssamtal

## Bjud in en tredje person

Öppna en privat chatt och klicka **Bjud in...**. Listan visar dina
online-kontakter som inte redan deltar. När du väljer en kontakt skickas
deltagarnas användar-id till `POST /api/conversations/conference`.

[conversations.js](../server/routes/conversations.js) skapar alltid en
**ny** konversation med `is_group = TRUE`. Deltagarna och ett första
systemmeddelande sparas i samma transaktion. Ingen privat historik kopieras.
Även en ytterligare inbjudan från en konferens skapar en separat konferens.

De anslutna deltagarnas sockets går med i det nya rummet. Händelsen
`conference_created` öppnar konferensen automatiskt i deras webbläsare.
Rubriken visar deltagarnas namn.

## Meddelanden och knappar

Text, emojis, nudge och bilagor använder samma flöde som den privata
chatten. Varje meddelande skickas en gång till varje deltagarsocket.
Gruppmeddelanden räknas inte som privata olästa meddelanden i kontaktlistan.

- Text visar avsändarens namn.
- Systemmeddelanden visas centrerade, gråa och kursiva.
- En live-nudge skakar den öppna konferensen och spelar nudgeljudet.
- Knapparna ovanför chatten låter dig återvända till konferenser efter
  att du har öppnat en privat chatt.
- Efter F5 hämtas de konferenser du fortfarande deltar i, utan att
  automatiskt öppna ett samtal.

## Lämna samtalet

**Lämna samtalet** anropar `POST /api/conversations/:id/leave`.
Servern tar bort din deltagarpost och lägger in ett systemmeddelande.
De andra ser att du har lämnat, och deras deltagarlista uppdateras.
Dina sockets lämnar också rummet och ditt chattfönster stängs.

Efteråt får du inte längre läsa historiken eller skicka i konferensen.
En privat konversation mellan samma personer påverkas inte.
Konferenser läggs inte till som kontakter och återanvänds aldrig som
privata samtal. Databasposterna behålls, men när alla lämnat finns ingen
deltagare som kan öppna dem.

## Databasen

[conference.sql](../database/conference.sql) lägger till `is_group` och
tillåter meddelandetypen `system`. Kontrollen körs vid serverstart,
även på Render. Ett migrationsfel stoppar starten i stället för att
servern körs med fel schema.

**Prova:** skriv privat mellan A och B, bjud sedan in C. C ska inte se
den privata texten. Skicka text och nudge i konferensen, låt B lämna,
och öppna sedan A:s privata chatt med B: den gamla privata texten finns kvar.

[Till innehållsförteckningen](./README.md)
