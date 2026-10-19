# 12) Videosamtal med webcam

## Ringa en kontakt

Öppna en privat chatt och klicka **Webcam...**. Webbläsaren ber om
tillgång till kamera och mikrofon. Motparten får en inkommande samtalsruta
med **Acceptera** och **Avvisa**. Ingen kamera startas hos mottagaren
innan personen accepterar.

Webcam-knappen visas inte i konferenser. Ett konto kan bara delta i
ett videosamtal åt gången. Om mottagaren har flera flikar kan bara
en flik acceptera; de andra stänger sin inkommande ruta.

## Vad gör Socket.io och WebRTC?

[webrtc.js](../public/js/webrtc.js) innehåller klientlogiken.
[chatSocket.js](../server/sockets/chatSocket.js) förmedlar bara signalerna:

- `webrtc_call_user`: ring en användare i en privat konversation.
- `webrtc_answer_call`: acceptera och välj mottagarens flik.
- `webrtc_reject_call`: avvisa anropet.
- `webrtc_signal`: förmedla SDP och ICE.
- `webrtc_end_call`: lägg på.

Servern använder sessionens identitet, kontrollerar att båda är deltagare
i en privat chatt med exakt två personer och ger samtalet ett eget id.
Signaler skickas bara mellan de två valda sockets som deltar.

**SDP** beskriver ljud- och videoanslutningen. **ICE-kandidater** beskriver
möjliga nätverksvägar. WebRTC skickar sedan själva ljudet och bilden
mellan webbläsarna, inte genom chattservern. Inga inspelningar sparas.

## STUN och begränsningar

Endast `stun:stun.l.google.com:19302` används. Ingen TURN-server,
ny prenumeration eller extra npm-modul behövs.

STUN fungerar inte på alla nätverk. Skolnät eller strikta brandväggar
kan hindra anslutningen. Då visas ett fel och samtalet avslutas.
Att signaleringen fungerar betyder inte att media säkert kan ansluta.

Kamera och mikrofon kräver **HTTPS** (till exempel Render-adressen)
eller **localhost** vid lokal utveckling. Användaren måste också godkänna
webbläsarens kamera- och mikrofonbehörigheter.

## Avsluta och frigöra kameran

**Avsluta samtalet** eller **X** stänger anslutningen och anropar
`track.stop()` på kamera- och mikrofonspåren. Samma städning körs när
motparten lägger på, socketen kopplas från, användaren loggar ut
eller sidan lämnas. Även en ström som levereras sent från en
öppen behörighetsdialog stoppas.

Textchatt, privata meddelanden och konferenser är separata från
videosamtalet och fortsätter använda sina befintliga flöden.
Byte av chatt lägger inte på videosamtalet; använd avslutningsknappen.

Ringsignalen använder den befintliga Web Audio-motorn. Webbläsaren kan
blockera ljud före första användarklicket. Om fjärrvideons ljud blockeras
visas **Spela video och ljud**.

**Prova:** logga in som två olika användare på två enheter, öppna en
privat chatt, ring och acceptera. Kontrollera bild och ljud åt båda håll.
Lägg på och kontrollera att kameralampan släcks. Testa även Avvisa,
att ladda om sidan och att neka kamerabehörighet.

[Till innehållsförteckningen](./README.md)
