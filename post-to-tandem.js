import eWeLink from "ewelink-api-next";
import fetch from "node-fetch";

async function getTemp() {
  const client = new eWeLink.WebAPI({
    appId: process.env.EWL_APP_ID,
    appSecret: process.env.EWL_APP_SECRET,
    region: process.env.EWL_REGION || "us",
    logObj: console,
  });
  try {
    // Login to eWeLink using account credentials
    await client.user.login({
      account: process.env.EWL_EMAIL,
      password: process.env.EWL_PASSWORD,
      areaCode: process.env.EWL_AREACODE || "+1", // Adjust to your country code, e.g., "+91"
    });
    // Fetch Zigbee sensor status
    const res = await client.device.getThingStatus({ deviceId: process.env.EWL_DEVICE_ID });
    const params = res?.data?.params || res?.data || {};
    // Extract temperature from possible parameter keys
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
  if (Number.isFinite(temp)) {
    await postToTandem(temp);
  } else {
    console.log("No valid numeric temperature found");
  }
}

main();