import fs from 'fs';

export function writeToJSON(data, fileName = 'data.json') {
  let json = JSON.stringify(data, null, 2);
  fs.writeFile(fileName, json, 'utf8', function (err) {
    if (err) {
      console.log(err);
    }
  });
}
