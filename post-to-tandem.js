import eWeLink from "ewelink-api-next";
import fetch from "node-fetch";
import fs from "fs/promises";
import path from "path";

// Configuration
const TEMP_THRESHOLD = 0.2; // Minimum temperature change to trigger post
const LAST_TEMP_FILE = "last_temp.txt";

async function getTemperature() {
  const client = new eWeLink.WebAPI({
    appId: process.env.EWL_APP_ID,
    appSecret: process.env.EWL_APP_SECRET,
    region: process.env.EWL_REGION || "as",
    logObj: {
      info: (msg) => console.log(`[eWeLink] ${msg}`),
      error: (msg) => console.error(`[eWeLink Error] ${msg}`)
    },
  });

  try {
    console.log("Logging into eWeLink...");
    await client.user.login({
      account: process.env.EWL_EMAIL,
      password: process.env.EWL_PASSWORD,
      areaCode: process.env.EWL_AREACODE || "+91",
    });

    console.log(`Fetching temperature from device: ${process.env.EWL_DEVICE_ID}`);
    const response = await client.device.getThingStatus({ 
      deviceId: process.env.EWL_DEVICE_ID 
    });

    if (!response?.data) {
      throw new Error("No data received from device");
    }

    const params = response.data.params || response.data;
    console.log("Device params:", JSON.stringify(params, null, 2));

    // Try multiple possible temperature keys for different Zigbee sensors
    const temp = params.temperature ?? 
                 params.currentTemperature ?? 
                 params.temp ??
                 (params.tmp && (params.tmp.curr || params.tmp.current || params.tmp.value)) ?? 
                 params.value ??
                 params.temperatureC ??
                 params.tempC;

    if (temp === undefined || temp === null) {
      throw new Error(`No temperature found in device params: ${JSON.stringify(params)}`);
    }

    const numericTemp = Number(temp);
    if (!Number.isFinite(numericTemp)) {
      throw new Error(`Invalid temperature value: ${temp}`);
    }

    console.log(`Current temperature: ${numericTemp}°C`);
    return numericTemp;

  } catch (error) {
    console.error("Error fetching temperature:", error.message);
    throw error;
  }
}

async function readLastTemperature() {
  try {
    const data = await fs.readFile(LAST_TEMP_FILE, "utf8");
    const lastTemp = Number(data.trim());
    return Number.isFinite(lastTemp) ? lastTemp : null;
  } catch (error) {
    console.log("No previous temperature file found");
    return null;
  }
}

async function saveTemperature(temp) {
  try {
    await fs.writeFile(LAST_TEMP_FILE, temp.toString(), "utf8");
    console.log(`Saved temperature: ${temp}°C to ${LAST_TEMP_FILE}`);
  } catch (error) {
    console.error("Error saving temperature:", error.message);
  }
}

async function postToTandem(temp) {
  const payload = [{
    id: process.env.TANDEM_SIGNAL_ID,
    temp: temp,
    timestamp: new Date().toISOString()
  }];

  try {
    console.log(`Posting to Tandem: ${JSON.stringify(payload)}`);
    
    const response = await fetch(process.env.TANDEM_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${process.env.TANDEM_BASIC}`,
        "User-Agent": "eWeLink-Tandem-Bridge/1.0"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Tandem API error (${response.status}): ${errorText}`);
    }

    const result = await response.text();
    console.log(`Successfully posted temperature ${temp}°C to Tandem`);
    console.log(`Tandem response: ${result}`);
    
    return true;
  } catch (error) {
    console.error("Error posting to Tandem:", error.message);
    throw error;
  }
}

function validateEnvironment() {
  const required = [
    'EWL_APP_ID', 'EWL_APP_SECRET', 'EWL_EMAIL', 'EWL_PASSWORD', 
    'EWL_DEVICE_ID', 'TANDEM_URL', 'TANDEM_BASIC', 'TANDEM_SIGNAL_ID'
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

async function main() {
  try {
    console.log("=== eWeLink to Tandem Bridge ===");
    console.log(`Started at: ${new Date().toISOString()}`);
    
    // Validate environment
    validateEnvironment();
    
    // Get current temperature
    const currentTemp = await getTemperature();
    
    // Read last posted temperature
    const lastTemp = await readLastTemperature();
    
    // Determine if we should post
    let shouldPost = false;
    let reason = "";
    
    if (lastTemp === null) {
      shouldPost = true;
      reason = "First run - no previous temperature";
    } else {
      const tempDiff = Math.abs(currentTemp - lastTemp);
      if (tempDiff >= TEMP_THRESHOLD) {
        shouldPost = true;
        reason = `Temperature changed by ${tempDiff.toFixed(2)}°C (threshold: ${TEMP_THRESHOLD}°C)`;
      } else {
        reason = `Temperature change ${tempDiff.toFixed(2)}°C is below threshold (${TEMP_THRESHOLD}°C)`;
      }
    }
    
    console.log(`Decision: ${shouldPost ? 'POSTING' : 'SKIPPING'} - ${reason}`);
    
    if (shouldPost) {
      await postToTandem(currentTemp);
      await saveTemperature(currentTemp);
      console.log("✅ Successfully completed posting cycle");
    } else {
      console.log("⏸️ Skipped posting due to small temperature change");
    }
    
  } catch (error) {
    console.error("❌ Script failed:", error.message);
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

main();
