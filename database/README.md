# TweeLive Databaskonfiguration

## Översikt

TweeLive använder PostgreSQL (Supabase) för att lagra alla användar-, kontakt- och meddelandedata. Databasen är utformad för att stödja både en-till-en-konversationer och framtida gruppchatt-funktionalitet.

---

## Databastabeller

### 1. **users** (Befintlig tabell)

Lagrar användarinformation och autentiseringsuppgifter.

| Kolumn | Typ | Beskrivning |
|--------|-----|-------------|
| `id` | SERIAL | Primärnyckel |
| `username` | VARCHAR(50) | Unikt användarnamn |
| `email` | TEXT | Unik e-postadress |
| `password` | TEXT | Bcrypt-krypterat lösenord |
| `first_name` | VARCHAR(100) | Användarens förnamn |
| `last_name` | VARCHAR(100) | Användarens efternamn |
| `gender` | INTEGER | Kön (0=Man, 1=Kvinna) |
| `birth_date` | DATE | Födelsedag |
| `created_at` | TIMESTAMP | Registreringsdatum |

**Användning:** Källa för all användarautentisering och profildata.

---

### 2. **contacts** (Ny tabell)

Lagrar vänlista och kontaktstatus mellan användare.

| Kolumn | Typ | Beskrivning |
|--------|-----|-------------|
| `id` | SERIAL | Primärnyckel |
| `user_id` | INTEGER | Användaren som lade till kontakten (FK → users) |
| `contact_id` | INTEGER | Kontakten som lades till (FK → users) |
| `status` | VARCHAR(20) | Status: `'pending'`, `'accepted'`, eller `'blocked'` |
| `created_at` | TIMESTAMP | Tidpunkt när kontakten lades till |
| `updated_at` | TIMESTAMP | Senaste uppdatering |

**Kısıtlamalar:**
- `CHECK (user_id <> contact_id)` — Användare kan inte lägga till sig själva
- `UNIQUE(user_id, contact_id)` — Samma kontakt kan inte läggas till två gånger

**Användning:** Hantering av vänlista, väntande tillfrågningar och blockade användare.

---

### 3. **conversations** (Ny tabell)

Representerar en sohbetkanal (ett-till-ett eller grupp).

| Kolumn | Typ | Beskrivning |
|--------|-----|-------------|
| `id` | SERIAL | Primärnyckel |
| `created_at` | TIMESTAMP | När konversationen skapades |
| `updated_at` | TIMESTAMP | Senaste meddelandetid |

**Användning:** Grund för alla chattar. Minimalistisk design tillåter både ett-till-ett och framtida gruppchatt.

---

### 4. **conversation_participants** (Ny tabell)

Kopplingstabellen mellan konversationer och användare. Lagrar vilka användare som är med i vilken konversation.

| Kolumn | Typ | Beskrivning |
|--------|-----|-------------|
| `id` | SERIAL | Primärnyckel |
| `conversation_id` | INTEGER | Konversations-ID (FK → conversations) |
| `user_id` | INTEGER | Användar-ID (FK → users) |
| `joined_at` | TIMESTAMP | När användaren gick med |

**Kısıtlamalar:**
- `UNIQUE(conversation_id, user_id)` — Samma användare kan inte läggas till två gånger i samma konversation

**Användning:** Spåra vilka användare som är deltagare i vilka konversationer.

---

### 5. **messages** (Ny tabell)

Lagrar alla meddelanden som skickas i konversationer.

| Kolumn | Typ | Beskrivning |
|--------|-----|-------------|
| `id` | SERIAL | Primärnyckel |
| `conversation_id` | INTEGER | Konversations-ID (FK → conversations) |
| `sender_id` | INTEGER | Avsändarens användar-ID (FK → users) |
| `content` | TEXT | Meddelandets innehål |
| `message_type` | VARCHAR(20) | Typ: `'text'` (default) eller `'nudge'` (vibration/poke) |
| `is_read` | BOOLEAN | Om mottagaren läst meddelandet (default: FALSE) |
| `created_at` | TIMESTAMP | Tidpunkt när meddelandet skickades |

**Användning:** Lagring av all meddelandehistorik med stöd för MSN-specifika funktioner som "nudge" (titreşim).

---

## Databasens arkitektur

```
users
  ├── contacts (user_id, contact_id)
  ├── conversation_participants (user_id)
  └── messages (sender_id)
       └── conversations
            └── conversation_participants
```

### Flöde för ett-till-ett-meddelande:

1. Två användare existerar i `users`-tabellen
2. En `conversation` skapas
3. Båda användare läggs till i `conversation_participants`
4. Meddelanden sparas i `messages` med `conversation_id` och `sender_id`

---

## Indexer för prestanda

För att snabba upp vanliga frågor är följande indexer tillagda:

| Index | Tabell | Kolumner | Syfte |
|-------|--------|---------|-------|
| `idx_contacts_user_id` | contacts | user_id | Snabba upp sökning efter en användares kontakter |
| `idx_contacts_user_status` | contacts | user_id, status | Filtrera kontakter efter status |
| `idx_conversation_participants_*` | conversation_participants | conversation_id, user_id | Hitta medlemmar snabbt |
| `idx_messages_conversation_id` | messages | conversation_id | Hämta alla meddelanden i en konversation |
| `idx_messages_sender_id` | messages | sender_id | Hitta meddelanden från en specifik användare |
| `idx_messages_created_at` | messages | created_at DESC | Sortera meddelanden kronologiskt |

---

## Framtida utökningar

Denna databaskonfiguration är utformad för att enkelt stödja:

- **Gruppchatt:** `conversation_participants` kan redan innehålla flera användare
- **Chathistorik:** Meddelanden lagras permanent med tidsstämplar
- **Lässtatus:** `is_read`-kolumnen kan användas för att visa "lästa" vs "olästa" meddelanden
- **Blockering:** `contacts.status = 'blocked'` kan användas för att förhindra meddelanden
- **Framtida funktioner:** Filöverföring, röst, videosamtal kan läggas till i en `attachments`-tabell

---

## Säkerhet

- Alla lösenord är krypterade med Bcrypt (lagras ALDRIG i klartext)
- Foreign keys med `ON DELETE CASCADE` säkerställer att data rensas när användare raderas
- Unikt-begränsningar förhindrar dubblerade kontakter och konversationsmedlemmar
- CHECK-begränsningar validerar dataintegritet på databasnivå

---

**Skapad för:** TweeLive - Tweegee-tematiserad MSN Messenger-klon  
**Datum:** 2026-09-07  
**Version:** 1.0
