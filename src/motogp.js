import puppeteer from 'puppeteer';
import fetch from 'node-fetch';
import datefnstz from 'date-fns-tz';
import dotenv from 'dotenv';
import { writeToJSON } from './writeToJSON.js';

dotenv.config();
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

async function scraper() {
  console.log('Starting scraper...');
  try {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto('https://www.motogp.com/en/calendar');

    let events = await page.evaluate(() => {
      const data = [];

      const eventSelector = 'div.event_container:not(.hidden)';
      const eventContainers = document.querySelectorAll(eventSelector);

      for (let event of eventContainers) {
        const [round, name] = event
          .querySelector('a.event_name')
          .innerText.trim()
          .split(' - ');
        const [track, location] = event
          .querySelector('.location')
          .innerText.trim()
          .split('\n');
        const link = event.querySelector('a.event_name').href;
        data.push({
          name,
          location,
          track,
          round,
          link,
        });
      }
      return data;
    });

    for (let event of events) {
      console.log('Scraping -->', event.name);
      // navigate to the link of each event
      await page.goto(`${event.link}#schedule`);
      await page.click('p.c-schedule__time.radio[data-type="local"]');

      const sessions = await page.evaluate(() => {
        // TODO replace with keymap
        const fp1 = 'Free Practice Nr. 1';
        const fp2 = 'Free Practice Nr. 2';
        const fp3 = 'Free Practice Nr. 3';
        const fp4 = 'Free Practice Nr. 4';
        const q1 = 'Qualifying Nr. 1';
        const q2 = 'Qualifying Nr. 2';
        const race = 'Race';
        const searchOptions = [fp1, fp2, fp3, fp4, q1, q2, race];

        const data = [];

        for (let i = 1; i <= 3; i++) {
          const date = document.querySelector(
            `div.c-schedule__date[data-tab="day_${i}"]`
          ).innerText;

          const rowSelector = `div.c-schedule__table-container[data-tab="day_${i}"] div.c-schedule__table-row`;
          const rows = document.querySelectorAll(rowSelector);

          for (let row of rows) {
            const text = row.innerText.trim();
            const isMotoGP = text.includes('MotoGP');
            const race = searchOptions.find(
              (option) =>
                text.includes(option) && !text.includes('Race Press Conference')
            );
            if (isMotoGP && race) {
              let time = row
                .querySelector('div.c-schedule__time')
                .innerText.trim();
              let [start, end] = time.split(' - ');
              data.push({ race, date, start, end });
            }
          }
        }
        return data;
      });
      event.sessions = sessions;

      const timezoneOffset = await page.evaluate(
        () => document.querySelector('span.gmt_offset').innerText
      );
      event.timezoneOffset = timezoneOffset.slice(0, 2); // remove extra chars
    }

    // cleaning up data
    const updatedEvents = events.map(async (event) => {
      let slug = generateSlug(event.name);

      const [latitude, longitude] = await getLatLong(
        `${event.track}, ${event.location}`
      );

      let sessions = {};
      for (let session of event.sessions) {
        const { race, date, start } = session;
        const key = sessionKeyMap[race];
        sessions[key] = generateSessionTime(date, start, event.timezoneOffset);
      }

      event.location = captialise(event.location);
      event.latitude = latitude;
      event.longitude = longitude;
      event.sessions = sessions;
      event.slug = slug;
      event.localeKey = slug;

      delete event.link;
      delete event.timezoneOffset;

      return event;
    });

    let awaitedEvents = await Promise.all(updatedEvents);
    const result = { races: awaitedEvents };
    writeToJSON(result);

    await browser.close();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

// TODO fix non-alphanumeric characters
function generateSlug(string) {
  return string.toLowerCase().split(' ').join('-');
}

const sessionKeyMap = {
  'Free Practice Nr. 1': 'fp1',
  'Free Practice Nr. 2': 'fp2',
  'Free Practice Nr. 3': 'fp3',
  'Free Practice Nr. 4': 'fp4',
  'Qualifying Nr. 1': 'q1',
  'Qualifying Nr. 2': 'q2',
  Race: 'race',
};

function generateSessionTime(date, start, offset) {
  // pad the offset to fit correct format
  let [sign, hour] = offset.split('');
  let paddedOffset = `${sign ?? ''}${hour.padStart(2, 0)}:00`;

  // clean up the mixed date formats
  const cleanedDate = splitDate(date);

  // get the local race time as millis
  const raceTimeInMilliseconds = new Date(
    `${cleanedDate}, ${start}:00`
  ).getTime();

  // adjust the time for offset
  const adjustedForOffset = datefnstz.zonedTimeToUtc(
    raceTimeInMilliseconds,
    paddedOffset
  );

  return adjustedForOffset;
}

function splitDate(date) {
  if (date.includes('\n')) {
    date = date.split('\n').join(' ');
  }
  return date;
}

async function getLatLong(location) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${location}&key=${GOOGLE_API_KEY}`;
  const response = await fetch(url);
  const data = await response.json();

  const latitude = data.results[0].geometry.location.lat;
  const longitude = data.results[0].geometry.location.lng;

  return [latitude, longitude];
}

function captialise(string) {
  string = string.toLowerCase();
  return string.charAt(0).toUpperCase() + string.slice(1);
}

scraper();
