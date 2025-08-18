import eWeLink from "ewelink-api-next";
import fetch from "node-fetch";
import fs from "fs";

async function getTemp() {
  const client = new eWeLink.WebAPI({
    appId: process.env.EWL_APP_ID,
    appSecret: process.env.EWL_APP_SECRET,
    region: process.env.EWL_REGION || "as",
    logObj: console,
  });
  try {
    await client.user.login({
      account: process.env.EWL_EMAIL,
      password: process.env.EWL_PASSWORD,
      areaCode: process.env.EWL_AREACODE || "+91",
    });
    const res = await client.device.getThingStatus({ deviceId: process.env.EWL_DEVICE_ID });
    const params = res?.data?.params || res?.data || {};
    // SNZB-02P typically uses 'temperature' key
    const temp = params.temperature ?? 
                 params.currentTemperature ?? 
                 (params.tmp && (params.tmp.curr || params.tmp.value)) ?? 
                 params.value;
    return Number(temp);
  } catch (error) {
    console.error("Error fetching temperature:", error.message);
    return null;
  }
}

async function postToTandem(temp) {
  const body = [
    {
      id: process.env.TANDEM_SIGNAL_ID,
      temp: temp,
      timestamp: new Date().toISOString()
    }
  ];
  try {
    const response = await fetch(process.env.TANDEM_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${process.env.TANDEM_BASIC}`
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(`Tandem HTTP ${response.status}`);
    }
    console.log("Successfully posted temp:", temp);
  } catch (error) {
    console.error("Error posting to Tandem:", error.message);
  }
}

async function main() {
  const temp = await getTemp();
  if (!Number.isFinite(temp)) {
    console.log("No valid numeric temperature found");
    return;
  }

  // Read previous temperature
  let lastTemp = null;
  try {
    lastTemp = Number(fs.readFileSync("last_temp.txt", "utf8"));
  } catch (error) {
    console.log("No previous temperature found, will post first value");
  }

  // Post if temperature changed by >= 0.2°C or first run
  if (lastTemp === null || Math.abs(temp - lastTemp) >= 0.2) {
    await postToTandem(temp);
    // Save new temperature
    try {
      fs.writeFileSync("last_temp.txt", temp.toString(), "utf8");
    } catch (error) {
      console.error("Error saving temperature:", error.message);
    }
  } else {
    console.log(`Temperature change (${Math.abs(temp - lastTemp)}°C) too small, skipping post`);
  }
}

main();
