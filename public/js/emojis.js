    const emojier = [
      { kod: ':)', fil: 'tweegee-glad.svg', namn: 'Glad' },
      { kod: ':D', fil: 'tweegee-skrattande.svg', namn: 'Skrattande' },
      { kod: ';)', fil: 'tweegee-blink.svg', namn: 'Blinkande' },
      { kod: ':P', fil: 'tweegee-tunga.svg', namn: 'Räcker ut tungan' },
      { kod: '(L)', fil: 'tweegee-foralskad.svg', namn: 'Förälskad' },
      { kod: ':(', fil: 'tweegee-ledsen.svg', namn: 'Ledsen' }
    ];

    function skapaEmojiBild(emoji) {
      const bild = document.createElement('img');
      bild.src = `/emojis/${emoji.fil}`;
      bild.alt = emoji.kod;
      bild.title = emoji.namn;
      bild.className = 'chatt-emoji';
      return bild;
    }

    function visaTextMedEmojier(element, text) {
      // Textnoder bevarar vanlig text utan att tolka HTML från meddelanden.
      const monster = /:\)|:D|;\)|:P|\(L\)|:\(/g;
      let position = 0;
      for (const matchning of text.matchAll(monster)) {
        element.appendChild(document.createTextNode(text.slice(position, matchning.index)));
        const emoji = emojier.find(emoji => emoji.kod === matchning[0]);
        element.appendChild(skapaEmojiBild(emoji));
        position = matchning.index + matchning[0].length;
      }
      element.appendChild(document.createTextNode(text.slice(position)));
    }

    function stangEmojiMeny() {
      document.getElementById('emojiPopup').hidden = true;
      document.getElementById('emojiBtn').setAttribute('aria-expanded', 'false');
    }

    const emojiPopup = document.getElementById('emojiPopup');
    const emojiKnapp = document.getElementById('emojiBtn');
    emojier.forEach(emoji => {
      const valknapp = document.createElement('button');
      valknapp.type = 'button';
      valknapp.title = `${emoji.namn} ${emoji.kod}`;
      valknapp.setAttribute('aria-label', valknapp.title);
      valknapp.appendChild(skapaEmojiBild(emoji));
      valknapp.addEventListener('click', () => {
        const falt = document.getElementById('chatMessageInput');
        const start = falt.selectionStart;
        const slut = falt.selectionEnd;
        falt.setRangeText(emoji.kod, start, slut, 'end');
        stangEmojiMeny();
        falt.focus();
        falt.dispatchEvent(new Event('input', { bubbles: true }));
      });
      emojiPopup.appendChild(valknapp);
    });

    emojiKnapp.addEventListener('click', () => {
      emojiPopup.hidden = !emojiPopup.hidden;
      emojiKnapp.setAttribute('aria-expanded', String(!emojiPopup.hidden));
    });

    document.addEventListener('click', (event) => {
      if (!emojiPopup.contains(event.target) && !emojiKnapp.contains(event.target)) {
        stangEmojiMeny();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !emojiPopup.hidden) {
        stangEmojiMeny();
        emojiKnapp.focus();
      }
    });

