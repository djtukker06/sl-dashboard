# Studio Levant — Facturen

Een kleine webapp om altijd dezelfde, professionele factuur-PDF te genereren voor Studio Levant. Vul klant- en factuurgegevens in via een formulier, de app rekent BTW/subtotaal/totaal uit, kent automatisch een factuurnummer toe, en bewaart elke factuur (PDF + gegevens) in een archief per klant.

## Lokaal draaien

```bash
npm install
npm start
```

Ga naar `http://localhost:3000`.

> Node.js staat op deze Mac geïnstalleerd in `~/.local/node`. Als `node`/`npm` niet gevonden wordt, open een nieuwe terminal (het pad is toegevoegd aan `~/.zshrc`) of run eerst:
> `export PATH="$HOME/.local/node/bin:$PATH"`

## Inloggen

De app zit achter een inlogscherm (gebruikersnaam + wachtwoord, via de standaard browser-inlogpopup). De inloggegevens staan in `.env` (lokaal) en worden nooit meegecommit naar git — zie `.env.example` voor het formaat. Zonder deze variabelen is de app **niet beveiligd**, dus zorg dat ze altijd ingesteld staan zodra de app online staat.

## Hoe het werkt

- **Nieuwe factuur** (`/nieuwe-factuur`): vul klantgegevens en factuurregels in. De middelste kolom (bv. "Periode" of "Aantal") is optioneel — laat het naamveld leeg om die kolom helemaal weg te laten.
- **Factuurnummer**: wordt automatisch bepaald — `JJ-VVV` (laatste 2 cijfers van het jaar, dan het volgnummer). Telt door per kalenderjaar; begint bij een nieuw jaar automatisch weer bij 001.
- **Archief**: elke factuur wordt opgeslagen in `data/clients/<klantnaam>/<factuurnummer>.pdf` (+ een `.json` met dezelfde gegevens). De overzichtspagina (`/`) toont alle klanten en hun facturen, gegroepeerd per klant.
- **Vaste gegevens** (IBAN, KVK, BTW-nummer, adres, BTW-percentage, teksten): staan in [config.js](config.js). Wijzig dit bestand als iets verandert.

## Logo toevoegen

Er staat nu een marineblauw placeholder-vlak in plaats van het logo. Zodra je het logo-bestand hebt:

1. Zet het bestand (bij voorkeur PNG met transparante achtergrond, vierkant, min. 200×200px) in de map `assets/`, bijvoorbeeld `assets/logo.png`.
2. Open [views/factuur.ejs](views/factuur.ejs), zoek de regel `<div class="logo"></div>` en vervang die door:
   ```html
   <img class="logo" src="<%= logoDataUri %>" alt="Studio Levant logo">
   ```
3. Vraag me dan om `server.js` aan te passen zodat het logo als data-URI wordt meegegeven aan de template (dit voorkomt problemen met afbeeldingen laden tijdens PDF-generatie). Dat is een kleine aanpassing, ik regel 'm zodra je het bestand hebt.

## Online zetten op facturen.studio-levant.nl

Je host je site via Framer, en Framer kan geen Node.js-app draaien. Daarom zetten we deze app apart online bij een hostingpartij die dat wél kan, en koppelen we er een subdomein aan via DNS. Twee goede, makkelijke opties met een gratis/goedkope laag én **persistente opslag** (belangrijk, anders raak je je factuur-archief kwijt bij elke herstart):

### Optie A — Render.com (aanbevolen, makkelijkst)

1. Zet dit project in een git-repository (bv. op GitHub — vraag het me, dan regel ik dat).
2. Maak een gratis account op [render.com](https://render.com) en koppel je GitHub-account.
3. "New Web Service" → kies deze repository.
   - Build command: `npm install`
   - Start command: `npm start`
4. Voeg een **Persistent Disk** toe (Render noemt dit "Disks"), gekoppeld aan het pad `/opt/render/project/src/data` (of het pad dat Render aangeeft als project-root + `/data`) — zo blijft je factuur-archief bewaard bij elke herstart/update.
5. Zet bij "Environment" de variabelen `FACTUUR_APP_GEBRUIKERSNAAM` en `FACTUUR_APP_WACHTWOORD` (zie `.env.example`) — anders is de app niet beveiligd zodra hij online staat.
6. Zodra de service draait, krijg je een URL zoals `studio-levant-facturen.onrender.com`.
7. Ga naar je DNS-instellingen (bij de partij waar `studio-levant.nl` geregistreerd is — vaak dezelfde plek als waar Framer naar verwijst) en voeg een **CNAME-record** toe:
   - Naam: `facturen`
   - Waarde: `studio-levant-facturen.onrender.com`
7. Voeg in Render bij "Custom Domains" `facturen.studio-levant.nl` toe — Render regelt dan automatisch een SSL-certificaat (HTTPS).

### Optie B — Railway.app

Vergelijkbaar proces: project koppelen via GitHub, een "Volume" toevoegen voor `/data`, en daarna een custom domain + CNAME instellen zoals hierboven.

Ik help je graag stap voor stap zodra je zover bent — laat het weten.

## Belangrijk: back-ups

De map `data/clients/` is je hele factuur-archief (je boekhouding!). Zorg dat de hostingpartij die je kiest een persistente disk gebruikt, en overweeg om deze map periodiek te downloaden/back-uppen (bv. maandelijks handmatig, of via een export-functie die we later kunnen toevoegen).
