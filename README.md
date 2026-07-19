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

## Waarom procedureel geluid?

De onderzoeksnotitie adviseerde een mix van gegenereerde en gedownloade
CC0-loops. In deze bouwomgeving blokkeert de netwerk-policy echter alle externe
geluids-CDN's (Pixabay/Freesound/OpenGameArt gaven `403`). Procedurele synthese
lost dat elegant op: alle audio wordt in de browser berekend, is 100%
rechtenvrij, werkt offline en is licht genoeg voor de trage Tesla Atom-MCU (geen
AudioWorklet/WASM nodig). Sample-gebaseerde loops kunnen later als extra
geluidscategorie worden toegevoegd zodra er rechtenvrije bronnen beschikbaar
zijn.

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

Deze publicatie dekt fase 1–2 (audio-engine, demo + GPS, RPM-meter,
versnellingsbak, PWA). Volgende stappen: verfijnde schakel-accenten, meer
motorprofielen, en optioneel sample-gebaseerde loops.

## Licentie / rechten

Alle geluiden worden live gegenereerd; er worden geen opnames van derden
gebruikt. Locatie verlaat het apparaat nooit — alleen lokaal gebruikt voor
snelheid. Geen tracking, geen cookies, geen backend.
