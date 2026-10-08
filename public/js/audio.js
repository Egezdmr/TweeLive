    let ljudKontext = null;
    let ljudVolym = null;

    function uppdateraLjudKnapp() {
      const knapp = document.getElementById('ljudKnapp');
      const redo = ljudKontext && ljudKontext.state === 'running';
      knapp.hidden = Boolean(redo);
    }

    async function startaLjudKontext() {
      try {
        if (!ljudKontext) {
          if (!window.AudioContext) {
            console.warn('Webbläsaren saknar stöd för Web Audio API.');
            return false;
          }
          ljudKontext = new AudioContext();
          ljudVolym = ljudKontext.createGain();
          ljudVolym.gain.value = 1;
          ljudVolym.connect(ljudKontext.destination);
          ljudKontext.onstatechange = uppdateraLjudKnapp;
        }
        if (ljudKontext.state !== 'running') await ljudKontext.resume();
        uppdateraLjudKnapp();
        return ljudKontext.state === 'running';
      } catch (fel) {
        console.warn('Kunde inte aktivera ljudet:', fel);
        uppdateraLjudKnapp();
        return false;
      }
    }

    async function aktiveraLjud(event) {
      if (!event.isTrusted || event.target.closest('#ljudKnapp')) return;
      await startaLjudKontext();
    }

    async function spelaToner(toner) {
      // Händelser före första användarinteraktionen spelas inte upp i efterhand.
      if (!ljudKontext) return;
      if (ljudKontext.state !== 'running' && !await startaLjudKontext()) return;
      try {
        const nu = ljudKontext.currentTime;
        toner.forEach(({ frekvens, slutFrekvens = frekvens, start, langd, volym, typ = 'sine' }) => {
          const oscillator = ljudKontext.createOscillator();
          const styrka = ljudKontext.createGain();
          const tid = nu + start;
          oscillator.type = typ;
          oscillator.frequency.setValueAtTime(frekvens, tid);
          oscillator.frequency.exponentialRampToValueAtTime(slutFrekvens, tid + langd);
          styrka.gain.setValueAtTime(0, tid);
          styrka.gain.linearRampToValueAtTime(volym, tid + 0.012);
          styrka.gain.exponentialRampToValueAtTime(0.001, tid + langd - 0.02);
          styrka.gain.linearRampToValueAtTime(0, tid + langd);
          oscillator.connect(styrka);
          styrka.connect(ljudVolym);
          oscillator.onended = () => {
            oscillator.disconnect();
            styrka.disconnect();
          };
          oscillator.start(tid);
          oscillator.stop(tid + langd);
        });
      } catch (fel) {
        console.warn('Kunde inte spela aviseringsljudet:', fel);
      }
    }

    function playMessageSound() {
      spelaToner([
        { frekvens: 587, start: 0, langd: 0.18, volym: 0.09 },
        { frekvens: 880, start: 0.13, langd: 0.25, volym: 0.07 }
      ]);
    }

    function playNudgeSound() {
      spelaToner([
        { frekvens: 147, slutFrekvens: 110, start: 0, langd: 0.15, volym: 0.08, typ: 'triangle' },
        { frekvens: 147, slutFrekvens: 110, start: 0.17, langd: 0.15, volym: 0.08, typ: 'triangle' },
        { frekvens: 440, start: 0.32, langd: 0.22, volym: 0.06 }
      ]);
    }

    function playOnlineSound() {
      spelaToner([
        { frekvens: 523, start: 0, langd: 0.16, volym: 0.07 },
        { frekvens: 784, start: 0.12, langd: 0.23, volym: 0.06 }
      ]);
    }

    uppdateraLjudKnapp();
    document.addEventListener('click', aktiveraLjud, true);
    document.addEventListener('keydown', aktiveraLjud, true);
    document.getElementById('ljudKnapp').addEventListener('click', async () => {
      if (await startaLjudKontext()) {
        playMessageSound();
      } else {
        alert('Kunde inte aktivera ljudet. Kontrollera webbläsarens ljudbehörighet och försök igen.');
      }
    });

