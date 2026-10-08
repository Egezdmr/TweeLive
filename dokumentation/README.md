# Så fungerar TweeLive

Här finns korta förklaringar av projektets funktioner. Läs gärna filerna i
nummerordning. Varje guide beskriver flödet, de viktigaste filerna och ett
enkelt exempel som går att prova i webbläsaren.

1. [Databasanslutning](<./1) Databasanslutning.md>)
2. [Inloggning, registrering och sessioner](<./2) Inloggning och sessioner.md>)
3. [Kontakter, online-status och personliga statusmeddelanden](<./3) Kontakter och status.md>)
4. [Chatt 1: textmeddelanden och nudge](<./4) Chatt - text och nudge.md>)
5. [Bilder och ljudbilagor](<./5) Bilder och ljudbilagor.md>)
6. [Skrivindikator](<./6) Skrivindikator.md>)
7. [Olästa meddelanden](<./7) Olasta meddelanden.md>)
8. [Emojis och smiley-menyn](<./8) Emojis.md>)
9. [Aviseringsljud](<./9) Aviseringsljud.md>)
10. [Projektstruktur och tester](<./10) Projektstruktur och tester.md>)

## Några ord som återkommer

- **Frontend:** sidan och JavaScript-koden som körs i webbläsaren.
- **Backend:** Node.js-servern som hanterar förfrågningar och databasen.
- **API-rutt:** en adress på servern, till exempel `/api/login`.
- **Session:** serverns sätt att komma ihåg en inloggad användare.
- **Socket-händelse:** en realtidsnotis mellan servern och webbläsaren.

## Kopplingen till git-historiken

Guiderna följer funktionerna i projektets commits, från databasanslutningen
i steg 2.1 till ljudeffekterna i steg 16. De beskriver den **aktuella koden**,
även där filer har flyttats efter dessa commits.

Tidigare lösningar, som inloggning via lokal lagring, är alltså inte samma
sak som den sessionslösning som används idag.
