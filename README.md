# Vroom — EV motorgeluid

Geef je stille elektrische auto (bijv. een Tesla Model 3) een motorgeluid dat
meebeweegt met je **echte snelheid** en gesimuleerde **schakelmomenten**. Een
gratis, volledig statische web-app (PWA) — geen account, geen server, geen
verbinding met de auto.

**Live:** wordt via GitHub Pages gepubliceerd op
`https://falconnt.github.io/vroom/` zodra de deploy-workflow is gedraaid.

## Wat het doet

- **Snelheid** uit een demo-slider of je echte GPS-snelheid
  (`navigator.geolocation.watchPosition`), gesmooth en per frame
  geïnterpoleerd. Valt terug op afstand/tijd (haversine) als `coords.speed`
  niet beschikbaar is (o.a. de Tesla-browser).
- **Toerental** via een virtuele aandrijflijn: manuele modus met
  versnellingsbak (op-/afschakelen met korte gas-onderbreking) of lineaire
  modus.
- **Geluid** volledig procedureel gesynthetiseerd met de Web Audio API — geen
  geluidsbestanden, dus rechtenvrij en offline. Firing-frequentie per
  motortype, harmonischen, ruistextuur en een filter dat opengaat bij gas.

## Geluiden: echt opgenomen + procedureel

Er zijn twee categorieën geluid:

- **Echt opgenomen** — motorloops uit open-source racegames, vrij herbruikbaar
  onder hun licentie (GPL/MIT). Losse loops worden gepitcht met het toerental;
  gelaagde sets (diesel, RPM-bank) worden gecrossfade zoals racegames dat doen.
  Bronnen: VDrift (Ford GT, F40 — GPLv3), TORCS (Porsche, Subaru boxer, backfire
  — GPL), Trigger Rally (rally-motor + schakelgeluid — GPLv2), Rigs of Rods
  (gelaagde diesel — GPLv3), VehicleNoiseSynthesizer/ATG (RPM-bank — MIT). Zie
  `about.html` voor de volledige credits.
- **Procedureel** — volledig in de browser gesynthetiseerd (Web Audio), zonder
  bestanden. Rechtenvrij, werkt sowieso offline en is licht voor de trage Tesla
  Atom-MCU.

De externe geluids-CDN's (Freesound/Pixabay) zijn in de bouwomgeving geblokkeerd;
de echte samples komen daarom uit GitHub-gehoste open-source game-repos, die wél
bereikbaar zijn.

## Structuur

```
index.html            UI + START-scherm
about.html            uitleg / hoe werkt het
styles.css            styling (donker, dikke tap-targets voor autoscherm)
src/audioEngine.js    procedurele Web Audio-synthese
src/rpmModel.js       versnellingsbak / lineair rpm-model
src/speed.js          GPS + demo-snelheidsbron met smoothing
sw.js                 service worker (offline)
manifest.webmanifest  PWA-manifest
icons/                app-iconen
```

## Lokaal draaien

Elke statische server volstaat (geen buildstap):

```bash
npx http-server -p 8099 .
# of
python3 -m http.server 8099
```

Open daarna `http://127.0.0.1:8099/`. Klik **START** en test met de
demo-slider. GPS werkt alleen over HTTPS of `localhost`.

## In de Tesla gebruiken

- **Route A — Tesla-browser:** op recente firmware werkt GPS en blijft
  browser-audio doorspelen tijdens het rijden. Pauzeer eerst je actieve
  audiobron (radio/streaming).
- **Route B — telefoon + Bluetooth:** zet de app op je beginscherm (PWA),
  telefoon als Bluetooth-audiobron, scherm blijft aan via Wake Lock.

## Roadmap

- **Fase 1–2 ✅** audio-engine, demo + GPS, RPM-meter, PWA/offline.
- **Fase 3 ✅** versnellingsbak met op-/afschakelen, terugschakel-blip
  (rev-match), toerenbegrenzer met "bounce", startgeluid, shift-light, en
  extra motorprofielen (V8, Inline-4 turbo, V10, V-twin, Sci-Fi lineair).
- **Fase 4/5 (deels) ✅** overrun-knallen (backfire) bij gas loslaten op
  hoger toerental, en een reactieve achtergrond die meegloeit met het
  toerental (rood bij redline).
- **Echte geluiden ✅** 7 echt opgenomen motoren naast de 5 synth-geluiden:
  losse loops (Ford GT V8, F40, Porsche, Subaru boxer, rally) + gelaagde
  crossfade-sets (diesel, RPM-bank), met echte schakel- en backfire-samples.
- **Volgende** achtergrond-keuze, nog meer voertuigen, en fijnere afstemming
  van de pitch-windows per motor.

Vijf geluiden nu beschikbaar: **V8 Rumble**, **Inline-4 Turbo**,
**V10 Screamer**, **V-twin Motor** (alle manueel met versnellingsbak) en
**Sci-Fi Whine** (lineair).

## Licentie / rechten

Alle geluiden worden live gegenereerd; er worden geen opnames van derden
gebruikt. Locatie verlaat het apparaat nooit — alleen lokaal gebruikt voor
snelheid. Geen tracking, geen cookies, geen backend.
