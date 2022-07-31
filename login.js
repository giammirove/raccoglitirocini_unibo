import fetch from "node-fetch";
import fs from "fs";
import { printInfo, printError, readInput, readPasswd } from "./utils.js";

import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOGIN =
  "https://tirocini.unibo.it/tirocini/studenti/homePageStudenti.htm";
const SAML_CALLBACK =
  "https://tirocini.unibo.it/tirocini/adfs_callback?client_name=SAML2Client";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36";
const COOKIE_FILE = __dirname + "/cookie.json";

function getClientRequestId(body) {
  let reg = /(&client-request-id=.*?)"/gm;
  let res = reg.exec(body);
  if (res && res.length > 1) {
    return res[1];
  }
  throw "Client-Request-Id not found!";
}

function getMSISAuth(res) {
  let msis = res.headers.get("set-cookie");
  msis = msis.replace(msis.substr(msis.indexOf(";")), "");
  return msis;
}

function getSAMLResponse(body) {
  let reg = /SAMLResponse" value="(.*?)"/gm;
  let res = reg.exec(body);
  if (res && res.length > 1) {
    return res[1];
  }
  throw "SAML RESPONSE not found!";
}

async function getCookieFromFile() {
  try {
    if (fs.existsSync(COOKIE_FILE)) {
      let json = JSON.parse(fs.readFileSync(COOKIE_FILE));
      if (!json.cookie) {
        throw "Cookie non trovati!";
      }
      return json.cookie;
    } else {
      throw "Cookie non trovati!";
    }
  } catch (e) {
    throw e;
  }
}

async function setCookieToFile(cookie) {
  try {
    let json = JSON.parse(`{"cookie":"${cookie}"}`);
    fs.writeFileSync(COOKIE_FILE, JSON.stringify(json));
  } catch (e) {
    throw e;
  }
}

export async function retryLogin(user, pass) {
  setCookieToFile("");
  return await login(user, pass);
}

export async function login(user, pass) {
  try {
    return await getCookieFromFile();
  } catch (e) {
    printError("Cookie non trovati o invalidi!");
  }
  try {
    printInfo("Login");
    if (!user || !pass) {
      user = await readInput("Inserisci il tuo username : ");
      pass = await readPasswd("Inserisci la tua password : ");
    }
    console.log("");

    let cookie = "";
    let res = await fetch(LOGIN, {
      redirect: "manual",
    });
    let location = res.headers.get("location");
    cookie += "; " + res.headers.get("set-cookie");
    let SESSION_COOKIE = cookie;
    res = await fetch(location, {
      headers: {
        cookie: cookie,
      },
      redirect: "manual",
    });

    let html = await res.text();
    let url = res.url;

    let clientid = getClientRequestId(html);
    url += clientid;

    res = await fetch(url, {
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": USER_AGENT,
        cookie: cookie,
      },
      body: "HomeRealmSelection=AD+AUTHORITY&Email=",
      method: "POST",
    });
    let authUrl = res.url;
    if (res.headers.get("set-cookie"))
      cookie += "; " + res.headers.get("set-cookie");

    res = await fetch(authUrl, {
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": USER_AGENT,
        cookie: cookie,
        "sec-fetch-user": "?1",
        "upgrade-insecure-requests": "1",
      },
      body: `UserName=${encodeURIComponent(user)}&Password=${encodeURIComponent(
        pass
      )}&AuthMethod=FormsAuthentication`,
      method: "POST",
      redirect: "manual",
    });
    location = res.headers.get("location");
    let msis = getMSISAuth(res);

    res = await fetch(location, {
      headers: {
        "user-agent": USER_AGENT,
        cookie: msis + ";" + cookie,
      },
      method: "GET",
      redirect: "manual",
    });
    html = await res.text();

    let samlresponse = encodeURIComponent(getSAMLResponse(html));
    res = await fetch(SAML_CALLBACK, {
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": USER_AGENT,
        cookie: SESSION_COOKIE,
      },
      body: `SAMLResponse=${samlresponse}&RelayState=%3FspidL%3D1%26spidACS%3D0`,
      method: "POST",
      redirect: "manual",
    });

    SESSION_COOKIE = res.headers.get("set-cookie").replace(/,/gm, ";");

    printInfo("Login completato!");
    setCookieToFile(SESSION_COOKIE);
    return SESSION_COOKIE;
  } catch (e) {
    printError(e);
    login();
  }
}
