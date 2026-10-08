# 8) Emojis och smiley-menyn

## Texten sparas, bilden visas

Emojis bygger på sex SVG-bilder i [public/emojis](../public/emojis).
SVG är ett bildformat där former beskrivs med kod, så bilden kan skalas
utan att bli suddig.

| Kortkod | Uttryck |
|---|---|
| `:)` | Glad |
| `:D` | Skrattande |
| `;)` | Blinkande |
| `:P` | Tunga |
| `(L)` | Förälskad |
| `:(` | Ledsen |

Kortkoderna sparas som vanlig meddelandetext i databasen.
Det behövs alltså ingen särskild emoji-rutt på servern.

## Hur textparsern fungerar

[emojis.js](../public/js/emojis.js) innehåller kortkoderna och filnamnen.
`visaTextMedEmojier()` letar efter koder med ett reguljärt uttryck,
alltså ett sökmönster för text.

Text före och efter koden läggs till som textnoder.
Själva koden ersätts i vyn med en bild från `/emojis/...`.
Bilden visas i 22 × 22 px och placeras mitt på textraden.

`appendMessageBubble()` använder parsern för textmeddelanden.
Därför fungerar emojis både för historik och nya Socket.io-meddelanden.
Användarens text tolkas inte som HTML.

Parsern känner igen exakt koderna i tabellen. Till exempel är `:D`
inte samma sak som `:d`, och en vanlig Unicode-emoji blir inte automatiskt
en Tweegee-bild.

## Smiley-menyn

**Smiley** öppnar den lilla popupen ovanför skrivfältet.
När en bild väljs infogas dess kortkod vid markören, eller ersätter
markerad text. Fokus flyttas tillbaka till skrivfältet.

Menyn stängs när en emoji väljs, när man klickar utanför eller trycker
Escape. Ett `input`-event skickas även efter infogningen så att
skrivindikatorn får samma signal som vid vanlig tangentbordsskrivning.

**Prova:** skriv `Hej :D`, skicka och öppna chatten igen. Kortkoden
ska visas som samma SVG-bild i både det nya meddelandet och historiken.

**Git-bakgrund:** `8b88afc` (steg 15, emoticons).

[Till innehållsförteckningen](./README.md)
