# 9) Aviseringsljud med Web Audio API

## Inga ljudfiler behövs

[audio.js](../public/js/audio.js) skapar ljud direkt i webbläsaren med
Web Audio API. Dessa ljud laddas inte upp till Supabase och sparas inte
i databasen.

Ljudmotorn använder:

- **AudioContext:** miljön där webbläsaren skapar och spelar ljud.
- **Oscillator:** en signalgenerator som skapar en ton.
- **Gain:** en volymkontroll som gör att tonen börjar och slutar mjukt.

Frekvens mäts i Hz. Högre frekvens ger en ljusare ton.

## De tre ljuden

| Funktion | Ljud | När spelas det? |
|---|---|---|
| `playMessageSound()` | Två mjuka toner, 587 och 880 Hz. | Ett nytt meddelande från någon annan, även en bilaga. |
| `playNudgeSound()` | Två djupa pulser och ett pling. | En live-nudge från någon annan. |
| `playOnlineSound()` | Uppåtgående toner, 523 och 784 Hz. | En kontakt går från inte registrerad online till online i frontendens lista. |

[chat.js](../public/js/chat.js) väljer ljudet när socket-händelsen kommer.
En nudge får sitt eget ljud, inte både nudge- och meddelandeljud.
Egna meddelanden och laddning av historik spelar inga aviseringsljud.
Ett upprepat online-event för samma redan online-registrerade användare
ger inte ett nytt online-pling.

## Varför måste användaren klicka först?

Webbläsare kan blockera ljud innan användaren har interagerat med sidan.
Första riktiga klicket eller tangenttrycket försöker därför skapa och
starta ljudmotorn.

Knappen **Aktivera ljud** kan också användas. Den spelar ett provpling
och döljs när ljudmotorn är igång. Sidan har ingen mute-inställning:
ljudet är på när motorn har aktiverats.

Om webbläsaren pausar ljudmotorn försöker koden återuppta den.
Händelser före aktivering sparas inte för att spelas upp senare.
Webbläsarens flikinställning, systemvolym och ljudbehörigheter gäller fortfarande.

## Vad händer efter tonen?

Varje oscillator stoppas efter sin korta speltid. Oscillatorn och dess
volymnod kopplas sedan bort, så att gamla ljudnoder inte fortsätter användas.

**Prova:** aktivera ljud och låt en vän skicka text och nudge.
Om inget hörs, kontrollera först provplinget, flikens ljud och systemvolymen.

**Git-bakgrund:** `008eb13` (steg 16, ljudeffekter).

[Till innehållsförteckningen](./README.md)
