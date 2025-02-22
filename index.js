import { Client } from "@gradio/client";
import pkg from "fs-extra";
import { schedule } from "node-cron";

const { readJson, writeJson } = pkg;

// Configuration
const API_URL = "http://127.0.0.1:7788";
const OUTPUT_FILE = "./cashtag_results.json";

// Function to get current date and time in CET
const getCETTimestamp = () => {
  const now = new Date();
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(now);
};

// Function to filter out invalid entries
const filterInvalidEntries = results => {
  return results.filter(
    item => !(item.cashtag === null && item.contract_address === null)
  );
};

// Function to merge results without overwriting timestamps of old entries
const mergeResults = (existingResults, newResults) => {
  const existingMap = new Map(
    existingResults.map(item => [item.cashtag + item.contract_address, item])
  );

  newResults.forEach(newItem => {
    const key = newItem.cashtag + newItem.contract_address;
    if (!existingMap.has(key)) {
      // Add new item with a timestamp
      existingMap.set(key, { ...newItem, timestamp: getCETTimestamp() });
    }
    // If key exists, do nothing to avoid overwriting the timestamp
  });

  return Array.from(existingMap.values());
};

// Main function to fetch AI results and process them
const fetchAIResults = async () => {
  try {
    console.log("Starting AI Agent job...");

    // Initialize the Gradio client
    const client = await Client.connect(API_URL);

    // Send the task to the AI Agent
    const result = await client.predict("/run_with_stream", {
      agent_type: "custom",
      llm_provider: "gemini",
      llm_model_name: "gemini-2.0-flash-exp",
      llm_temperature: 1,
      use_own_browser: true,
      keep_browser_open: true,
      headless: false,
      disable_security: true,
      enable_recording: true,
      task: `
      Analyze the latest 10 tweets from the X.com following page to extract cashtags and contract addresses (CAs) as follows:

      1. Identify cashtags (e.g., $TOKEN) and their corresponding contract addresses (CAs). 
        - Add the results to a JSON array: 
          Example: [{ "cashtag": "$TOKEN", "contract_address": "CA" }]
      2. If a cashtag is found but no CA is included:
        - Search on X.com search functionality for the CA (max 10 tweets of search).
        - If found, add it to the JSON array. Otherwise, add: { "cashtag": "$TOKEN", "contract_address": null }.
      3. If a token is mentioned without a cashtag:
        - Record it as: { "cashtag": "unknown_cashtag", "contract_address": "CA" } (or null if no CA is found).
      4. If you find something being shilled on the tweet but there is no cashtag or CA found, try to search on X.com key words of the message to try to find the cashtag or the CA and then follow the previous points to find what is needed.
      5. If nothing is found after previous points, just skip the tweet and go to the next task. Try to not return empty data like:
        - { cashtag: 'unknown_cashtag', contract_address: null }
        As this is not useful at all.

      If you are not able to complete all the taks in 10 minutes, then stop completly.

      The final output should only contain a JSON array of the format:
      [
        { "cashtag": "$TOKEN", "contract_address": "CA" },
        { "cashtag": "unknown_cashtag", "contract_address": null }
      ]

      Do not include any additional text, explanations, or metadata outside the JSON array.
      `,
      add_infos: "X.com credentials for login: username: Azmuni427637, password: dag324523dfgsfadse3",
      max_steps: 100,
      max_actions_per_step: 10,
      tool_calling_method: "auto",
    });

    // Parse the new results
    const newResults = parseResults(result.data);

    // Filter invalid entries
    const filteredNewResults = filterInvalidEntries(newResults);

    // Read existing results
    const existingResults = await readJson(OUTPUT_FILE).catch(() => []);

    // Filter invalid entries from existing results
    const filteredExistingResults = filterInvalidEntries(existingResults);

    // Merge new and existing results
    const mergedResults = mergeResults(filteredExistingResults, filteredNewResults);

    // Save the updated results to the file
    await writeJson(OUTPUT_FILE, mergedResults, { spaces: 2 });
    console.log("Results saved:", mergedResults);
  } catch (error) {
    console.error("Error while calling AI Agent:", error.message);
  }
};

// Function to parse results
const parseResults = (result) => {
  let parsedResults = [];
  try {
    parsedResults = JSON.parse(result[1]); // Assuming result[1] is JSON formatted
  } catch (err) {
    console.error("Error parsing AI Agent output:", err.message);
  }
  return parsedResults;
};

// Schedule the job to run every 15 minutes
schedule("*/15 * * * *", async () => {
  await fetchAIResults();
});

fetchAIResults();

console.log("Cron job scheduled to run every 15 minutes.");