# 5) Bilder och ljudbilagor

## Två olika sorters ljud

En **ljudbilaga** är en fil som användaren skickar, till exempel en MP3.
Ett **aviseringsljud** är ett pling som sidan skapar när något händer.
Den här guiden handlar om filer. Plingljuden beskrivs i
[guide 9](<./9) Aviseringsljud.md>).

## Från filväljare till Storage

1. **Bifoga...** öppnar den dolda filväljaren.
2. [chat.js](../public/js/chat.js) kontrollerar att en chatt är vald och
   att filen inte är större än 3 MB.
3. Filen läggs i `FormData` under namnet `file`.
4. Frontend skickar POST till `/api/conversations/:id/upload`.
   Knappen visar **Laddar upp...** under arbetet.
5. Multer i [conversations.js](../server/routes/conversations.js) läser
   filen till serverns minne och har också en gräns på 3 MB.
6. Servern kontrollerar att användaren deltar i konversationen.
7. Filnamnets specialtecken ersätts med understreck. Ett tids- och
   slumpbaserat prefix läggs till.
8. Filen laddas upp med [supabase.js](../server/services/supabase.js)
   till bucketen **`chat_attachments`**.

Supabase-klienten använder `SUPABASE_URL` och `SUPABASE_ANON_KEY`.
Bucketens inställningar och åtkomstregler måste tillåta den uppladdning
och offentliga åtkomst som koden använder.

## Vad sparas i databasen?

Själva filen ligger i Storage. Meddelandets `content` innehåller den
offentliga URL:en. `message_type` blir `image` eller `audio`.

Efter sparandet skickar servern `new_message` till deltagarnas sockets,
precis som för text. Bilagan kan därför visas både direkt och i historiken.

- **Bild:** visas med ett `<img>`-element, högst 200 × 200 px.
  Klick öppnar bildens URL i en ny flik.
- **Ljud:** visas med `<audio controls>`. Webbläsarens spelarknappar
  används; filen startar inte automatiskt.

En offentlig URL är inte privat bara för att meddelande-API:t kräver
inloggning. Den som har länken kan läsa filen om bucketen tillåter det.

## Filformat och fel

Multer tillåter MIME-typer som börjar med `image/` eller `audio/`.
Det är en kontroll av den angivna filtypen, inte en analys av filens innehåll.
Vilka ljudformat som kan spelas beror också på webbläsaren.

Ogiltig typ eller saknad fil ger ett JSON-svar med status `400`.
För stora filer avvisas av Multers storleksgräns; den felvägen har ännu
ingen egen JSON-felhanterare. Frontend fångar även misslyckade svar och
visar ett felmeddelande.

Knappen återställs i `finally`, och filväljaren töms vid lyckat anrop
eller hanterat uppladdningsfel så att samma fil kan väljas igen.

**Prova:** skicka en liten PNG och en MP3. Öppna chatten igen och kontrollera
att bilagorna finns kvar. Prova också en fil över 3 MB.

**Git-bakgrund:** `6a4f5de` (förberedelser) och `54ce858` (steg 14).

[Till innehållsförteckningen](./README.md)
