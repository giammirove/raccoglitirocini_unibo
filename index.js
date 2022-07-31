import fetch from "node-fetch";
import { FormData } from "formdata-node";
import jsdom from "jsdom";
const { JSDOM } = jsdom;

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { printInfo, printError, readInput } from "./utils.js";
import { login, retryLogin } from "./login.js";

const BASE_URL = "https://tirocini.unibo.it/";
const TIROCINI_URL = `${BASE_URL}/tirocini/studenti/gestioneoffertetirocinio.htm?idTipoTirocinio=2`;
const TIROCINI_ENDPOINT = `${BASE_URL}/tirocini/studenti/gestioneoffertetirocinio.htm`;
const TIROCINIO_DETTAGLI_ENDPOINT = `${BASE_URL}/tirocini/studenti/dettagliooffertatirocinio.htm`;

const SESSIONE_SCADUTA = "Sessione scaduta";

const SPECIAL_KEY = "Azienda/Ente";
const MARKDOWN_FILE = "tirocini.md";

let cookie = "";

function myfetch(url, opts) {
  if (!opts) opts = {};
  if (!opts.headers) opts.headers = {};
  opts.headers["cookie"] = cookie;
  opts.redirect = "manual";
  return fetch(url, opts);
}

function checkResponse(res) {
  if (res.headers.get("location")) {
    return false;
  }
  return true;
}

async function getListOfMeta() {
  try {
    let res = await myfetch(TIROCINI_URL);
    if (!checkResponse(res)) {
      throw SESSIONE_SCADUTA;
    }
    let source = await res.text();
    const { document } = new JSDOM(source).window;

    let element_facolta = document.querySelector("#facolta");
    let options_facolta = element_facolta.querySelectorAll("option");
    let facolta = {};
    for (let i = 0; i < options_facolta.length; i++) {
      let name = options_facolta[i].textContent;
      let code = options_facolta[i].getAttribute("value");
      facolta[code] = name;
    }
    let element_corsi = document.querySelector("#corso");
    let options_corsi = element_corsi.querySelectorAll("option");
    let corsi = {};
    for (let i = 0; i < options_corsi.length; i++) {
      let name = options_corsi[i].textContent;
      let code = options_corsi[i].getAttribute("value");
      corsi[code] = name;
    }

    return { facolta, corsi };
  } catch (e) {
    throw e;
  }
}

function formatText(text) {
  if (text == null || text == undefined) return text;
  text = text.replace(/&#8220;/g, "“");
  text = text.replace(/&#8221;/g, "”");
  text = text.replace(/&#8211;/g, "-");
  text = text.replace(/&#8217;/g, "'");
  text = text.replace(/&#8230;/g, "...");
  text = text.replace(/&#039;/g, "'");
  text = text.replace(/&#038;/g, "&");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#039;/g, "'");
  return text;
}

function cleanText(txt) {
  return formatText(txt.replace(/\t/gm, "").replace(/\r/g, "")).trim();
}

async function getSearchResult(facolta_code, corso_code, page_num) {
  try {
    if (page_num === undefined) page_num = 1;

    if (facolta_code && corso_code) {
      const form = new FormData();
      form.append("denominazioneAzienda", "");
      form.append("cerca", "Search");
      form.append("tipoCiclo", 1);
      form.append("facolta", facolta_code);
      form.append("corso", corso_code);
      form.append("form_submit", true);
    }

    let url = `${TIROCINI_ENDPOINT}?page=${page_num}`;
    let res;
    if (facolta_code && corso_code)
      res = await myfetch(url, {
        method: "POST",
        body: form,
      });
    else res = await myfetch(url);
    if (!checkResponse(res)) {
      throw SESSIONE_SCADUTA;
    }
    let source = await res.text();
    const { document } = new JSDOM(source).window;

    let pages_num_element = document.querySelector(".icePnlGrdColumn2");
    let pages_num = 0;
    if (pages_num_element)
      pages_num = parseInt(
        /Pagina [0-9].*?\/([0-9].*?)/g.exec(pages_num_element.textContent)[1]
      );

    let table = document.querySelector(".iceDataTblOutline");
    let rows = table.querySelectorAll("tr");
    let results = [];
    let fields = [];
    let columns_fields = rows[0].querySelectorAll("th");
    for (let i = 0; i < columns_fields.length; i++) {
      let txt = cleanText(columns_fields[i].textContent);
      if (txt) fields.push(txt);
    }
    for (let i = 1; i < rows.length; i++) {
      let columns = rows[i].querySelectorAll("td");
      let item = {};
      for (let j = 0; j < fields.length; j++) {
        let txt = cleanText(columns[j].textContent);
        if (txt) item[fields[j]] = txt;
      }

      results.push(item);
    }

    if (page_num != pages_num) {
      let rec_results = await getSearchResult(
        facolta_code,
        corso_code,
        page_num + 1
      );
      for (let i = 0; i < rec_results.length; i++) {
        results.push(rec_results[i]);
      }
    }

    return results;
  } catch (e) {
    throw e;
  }
}

async function getInternshipInfo(code) {
  try {
    let url = `${TIROCINIO_DETTAGLI_ENDPOINT}?selecttirocinio=${code}`;
    let res = await myfetch(url);
    if (!checkResponse(res)) {
      throw SESSIONE_SCADUTA;
    }
    let source = await res.text();
    const { document } = new JSDOM(source).window;

    let tables = document.querySelectorAll(".tbSimpleData");
    let infos = {};
    for (let t = 0; t < tables.length; t++) {
      let table = tables[t];
      let rows = table.querySelectorAll("tr");
      for (let i = 0; i < rows.length; i++) {
        let cols = rows[i].querySelectorAll("td");
        if (cols.length > 2) {
          throw "Riga con piu' di due colonne";
        }
        if (cols.length == 2) {
          let key = cleanText(cols[0].textContent).replaceAll(":", "");
          let value = cleanText(cols[1]?.innerHTML);
          // avoid situations like `<ul> </ul>` that will break markdown
          if (cleanText(cols[1].textContent) == "") value = "";
          infos[key] = value;
        }
      }
    }
    return infos;
  } catch (e) {
    throw e;
  }
}

function generateMarkDown(internships) {
  let m = "## INTERNSHIPS\n";
  for (let i = 0; i < internships.length; i++) {
    let item = internships[i];
    m += `### ${item[SPECIAL_KEY]}\n`;
    let keys = Object.keys(item);

    for (let j = 0; j < keys.length; j++) {
      if (keys[j] != SPECIAL_KEY)
        m += `###### ${keys[j]} \n${item[keys[j]]} \n`;
      if (item[keys[j]].endsWith("</ul>")) m += "\n";
    }
    m += "\n\n---\n\n";
  }

  return m;
}

function saveMarkDown(md) {
  let p = path.join(__dirname, MARKDOWN_FILE);
  fs.writeFileSync(p, md);
  return p;
}

async function main() {
  try {
    cookie = await login();
    // let meta = await getListOfMeta();
    // looks like that if u dont execute `getListOfMeta` before `getSearchResult`
    // you'll got a strange from backend :(
    // ( just if you run getSearchResult with parameters ... )
    printInfo("Cerco i tirocini");
    // let results = await getSearchResult("AMB9", 33);
    // if not specified will be searched the default internhips
    let results = await getSearchResult();
    printInfo(`${results.length} tirocini trovati`);
    printInfo(`Raccolgo i dettagli di ogni tirocinio`);
    let items = [];
    for (let i = 0; i < results.length; i++) {
      let item = await getInternshipInfo(results[i].Id);
      items.push(item);
    }
    let md = generateMarkDown(items);
    let p = saveMarkDown(md);
    printInfo(`Markdown generato in\n\t${p}`);
  } catch (e) {
    printError(e);
    if (e == SESSIONE_SCADUTA) {
      cookie = await retryLogin();
      printInfo("Login effettuato di nuovo");
      main();
    }
  }
}

main();
