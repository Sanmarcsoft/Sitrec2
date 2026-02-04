// take a csv file, which is a 2d array [row][col]
// the header row indicated wih
import {findColumn, parseISODate} from "./ParseUtils";
import {MISB, MISBFields} from "./MISBUtils";
import {GlobalDateTimeNode, Sit} from "./Globals";
import {f2m} from "./utils";
import {parseMGRS} from "./CoordinateParser";

export function isPBAFile(text) {
    return text.startsWith("---Pico Balloon Archive");
}

export function extractPBACSV(text) {
    const separatorIndex = text.indexOf("-----");
    if (separatorIndex === -1) {
        return text;
    }
    const afterSeparator = text.indexOf("\n", separatorIndex);
    if (afterSeparator === -1) {
        return "";
    }
    return text.substring(afterSeparator + 1);
}


// For a custom format we have a list of acceptable column headers
// for the various needed fields
// we need at least time, lat, lon
// if alt is missing or empty fields, then assume on the ground/sea level
// alt is assumed to be in meters unless an "altFeet" column is present
// if we have a trackID, then we group those points as one track (so multiple tracks per CSV file)
// Time can be in ms (Epoch time) or ISO date string
// case is ignored for header matching
const CustomCSVFormats = {
    CUSTOM1: {
        trackID:  ["THRESHERID", "TRACK_ID", "STAGENUMBER"],
        time:     ["TIME", "TIMESTAMP", "DATE", "UTC", "DATETIME", "DATE_TIME", "DATETIME_UTC", "DTG", "DT", "FRAME"],
        lat:      ["LAT", "LATITUDE", "TPLAT", "LATITUDEDEGS"],
        lon:      ["LON", "LONG", "LONGITUDE", "TPLON", "LONGITUDEDEGS"],
        mgrs:     ["MGRS", "GRID", "GRIDREF", "GRID_REF"],
        alt:      ["ALTITUDE", "ALT", "ALTITUDE (m)*", "TPHAE", "alt_m"],
        agl:      ["AGL", "ALT (m/agl)"],
        altFeet:  ["ALTITUDE (FT)", "ALT (FT)", "ALTITUDE(FT)", "ALT(FT)"],
        altKm:    ["ALTITUDEKM"],
        aircraft: ["AIRCRAFT", "AIRCRAFTSPECIFICTYPE"],
        callsign: ["CALLSIGN", "TAILNUMBER", "BALLOON_CALLSIGN"],
        az:       ["AZIMUTH", "AZ", "AZIMUTHDEGS"],
    }
}


export function isCustom1(csv) {
    // CUSTOM1 is one of several custom track format exported from some database
    // at a minimum it has time, lat, lon (or MGRS as alternative to lat/lon)
    // optionally it has aircraft and callsign

    // csv[0] is the header row
    const headerValues= CustomCSVFormats.CUSTOM1;
    // we need time and either (lat+lon) or mgrs
    const hasTime = findColumn(csv, headerValues.time, true) !== -1;
    const hasLatLon = findColumn(csv, headerValues.lat, true) !== -1
        && findColumn(csv, headerValues.lon, true) !== -1;
    const hasMGRS = findColumn(csv, headerValues.mgrs, true) !== -1;

    if (hasTime && (hasLatLon || hasMGRS)) {
        return true;
    }

    return false;
}

export function parseCustom1CSV(csv) {
    const rows = csv.length;
    let MISBArray = new Array(rows - 1);

    // Possible new formats:
    // thresherId,dtg,lat,lon,alt,tailNumber - Aircraft
    // track_Id,dtg,lat,lon,tailNumber


    const headerValues= CustomCSVFormats.CUSTOM1;
    const trackIDCol =  findColumn(csv, headerValues.trackID, true)
    const dateCol =     findColumn(csv, headerValues.time, true)
    const latCol =      findColumn(csv, headerValues.lat, true)
    const lonCol =      findColumn(csv, headerValues.lon, true)
    const mgrsCol =     findColumn(csv, headerValues.mgrs, true)
    const altCol =      findColumn(csv, headerValues.alt, true)
    const altFeet =     findColumn(csv, headerValues.altFeet, true)
    const altKmCol =    findColumn(csv, headerValues.altKm, true)
    const aglCol =      findColumn(csv, headerValues.agl, true)
    const azCol =       findColumn(csv, headerValues.az, true)
    const aircraftCol = findColumn(csv, headerValues.aircraft, true)
    const callsignCol = findColumn(csv, headerValues.callsign, true)

    const useMGRS = mgrsCol !== -1 && (latCol === -1 || lonCol === -1);

    const timeColHeader = csv[0][dateCol];
    console.log("Detected Custom1 CSV format with columns: " +
        "trackIDCol=" + trackIDCol + ", " +
    "dateCol=" + dateCol + " (\"" + timeColHeader + "\"), latCol=" + latCol +
        ", lonCol=" + lonCol + ", mgrsCol=" + mgrsCol + (useMGRS ? " (using MGRS)" : "") +
        ", altCol=" + altCol +
        ", aglCol=" + aglCol +
        ", altFeet=" + altFeet +
        ", altKmCol=" + altKmCol +
        ", aircraftCol=" + aircraftCol +
        ", callsignCol=" + callsignCol);

    // speed is currently ignored, and is generally derived from the position data
    const speedCol = findColumn(csv, "SPEED_KTS", true)

  //  const startTime = parseISODate(csv[1][dateCol])
  //  console.log("Detected Airdata start time of " + startTime)


    let isNumberTime = false;
    let isRelativeTime = false;
    let isFrameTime = false;

    // Check if the time column header is "FRAME" (case-insensitive)
    const timeHeader = csv[0][dateCol].toUpperCase();
    if (timeHeader === "FRAME") {
        isFrameTime = true;
        isRelativeTime = true;
    }

    const firstDateValue = csv[1][dateCol];
    // is it just a postive number, possible with decimal point?
    const relativeTimeRegex = /^\d+(\.\d+)?$/;
    if (relativeTimeRegex.test(firstDateValue)) {
        isNumberTime = true;

        // detect to see if the time is relative in seconds
        // not perfect, but works for most cases
        // we assume if the first date is less than 1, it's relative time in seconds
        const firstDate = Number(csv[1][dateCol]);
        if (firstDate < 1 && !isFrameTime) {
            isRelativeTime = true;
        }
    }

    for (let i = 1; i < rows; i++) {
        // any empty cell will be null
        MISBArray[i - 1] = new Array(MISBFields).fill(null);

        let date = null;
        // date can either be an ISO date string, or a number (epoch time in µs, ms or seconds)
        // parseISODate assumes Zulu time if no timezone specified
        if (isFrameTime) {
            // frame number - convert to time using fps
            const frame = Number(csv[i][dateCol]);
            const startTime = GlobalDateTimeNode.dateStart.valueOf();
            date = startTime + (frame / Sit.fps * 1000);
        } else if (isNumberTime) {
            // try to parse as a number
            // we don't distinguish the units here, as that's handled by CNodeMISBData::getTime()
            date = Number(csv[i][dateCol]);
            if (isRelativeTime) {
                const startTime = GlobalDateTimeNode.dateStart.valueOf();
                date = startTime + date * 1000;
            }
        }
        else {
            date = parseISODate(csv[i][dateCol]).getTime();

            if (i < 200) {
                console.log(`ISO date string detected, row ${i} time=${csv[i][dateCol]} converted to ${date} ms`);
            }
        }

        // at this point date is in milliseconds or microseconds since epoch
        MISBArray[i - 1][MISB.UnixTimeStamp] = date;

        if (useMGRS) {
            const mgrsValue = csv[i][mgrsCol];
            const coords = parseMGRS(mgrsValue);
            if (coords) {
                MISBArray[i - 1][MISB.SensorLatitude] = coords.lat;
                MISBArray[i - 1][MISB.SensorLongitude] = coords.lon;
            } else {
                console.warn(`Invalid MGRS value at row ${i}: ${mgrsValue}`);
                MISBArray[i - 1][MISB.SensorLatitude] = null;
                MISBArray[i - 1][MISB.SensorLongitude] = null;
            }
        } else {
            MISBArray[i - 1][MISB.SensorLatitude] = Number(csv[i][latCol])
            MISBArray[i - 1][MISB.SensorLongitude] = Number(csv[i][lonCol])
        }

        if (trackIDCol !== -1) {
            MISBArray[i - 1][MISB.TrackID] = csv[i][trackIDCol];
        }

        // we expect either alt or agl to be present, but not both
        // altitude is in meters, agl is in meters above ground level
        // they are just used in in inverted priority
        // so we use alt if present, otherwise agl
        // and then altFeet takes precedence over both
        // (this is to support some datasets that have alt in feet)
        if (altCol !== -1) {
            MISBArray[i - 1][MISB.SensorTrueAltitude] = Number(csv[i][altCol]);
        }

        if (aglCol !== -1) {
            MISBArray[i - 1][MISB.AltitudeAGL] = Number(csv[i][aglCol]);
        }

        // altFeet takes precedence over alt in meters
        if (altFeet !== -1) {
            const altitude = f2m(Number(csv[i][altFeet]));
            MISBArray[i - 1][MISB.SensorTrueAltitude] = isNaN(altitude) ? null : altitude;
        }

        // altKm takes precedence over altFeet
        if (altKmCol !== -1) {
            const altitude = Number(csv[i][altKmCol]) * 1000;
            MISBArray[i - 1][MISB.SensorTrueAltitude] = isNaN(altitude) ? null : altitude;
        }

        if (aircraftCol !== -1) {
            MISBArray[i - 1][MISB.PlatformDesignation] = csv[i][aircraftCol]
        }
        if (callsignCol !== -1) {
            MISBArray[i - 1][MISB.PlatformTailNumber] = csv[i][callsignCol]
        }
        if (speedCol !== -1) {
            MISBArray[i - 1][MISB.PlatformTrueAirspeed] = Number(csv[i][speedCol]);
        }

        // NO FOV
        //MISBArray[i - 1][MISB.SensorVerticalFieldofView] = 0

    }

    // For relative-time tracks, attach metadata so downstream consumers can
    // allow user to override the start time via trackStartTime GUI field
    if (isRelativeTime) {
        MISBArray.isRelativeTime = true;
        MISBArray.parsingBaseTime = GlobalDateTimeNode.dateStart.valueOf();
    }

    return MISBArray;

}

export function parseCustomFLLCSV(csv) {


    // get the global start time in MS
    const startTime = GlobalDateTimeNode.dateStart.valueOf()

    const rows = csv.length;
    let MISBArray = new Array(rows - 1);

    const altCol = findColumn(csv, "Alt");

    for (let i = 1; i < rows; i++) {
        MISBArray[i - 1] = new Array(MISBFields).fill(null);

        const frame = Number(csv[i][0]);
        // givena  frame number, we can derive the time from the DateTime object's start time
        const date = startTime + (frame / Sit.fps * 1000);


        MISBArray[i - 1][MISB.UnixTimeStamp] = date;

        MISBArray[i - 1][MISB.SensorLatitude] = Number(csv[i][1])
        MISBArray[i - 1][MISB.SensorLongitude] = Number(csv[i][2])

        if (altCol !== -1) {
            const altitude = f2m(Number(csv[i][altCol]));
            MISBArray[i - 1][MISB.SensorTrueAltitude] = isNaN(altitude) ? null : altitude;
        }

    }

    // FLL format uses frame numbers relative to sitch start time,
    // so always mark as relative time for trackStartTime GUI support
    MISBArray.isRelativeTime = true;
    MISBArray.parsingBaseTime = startTime;

    return MISBArray;
}


// FR24 headers are Timestamp, UTC, Callsign, Position, Altitude, Speed, Direction
export function isFR24CSV(csv) {
    // check the first row for the headers
    const header = csv[0];
    // check in the exact position
    return header[0] === "Timestamp" && header[1] === "UTC" &&
        header[2] === "Callsign" && header[3] === "Position" &&
        header[4] === "Altitude" && header[5] === "Speed" &&
        header[6] === "Direction";
}

export function parseFR24CSV(csv) {
    const rows = csv.length;
    let MISBArray = new Array(rows - 1);

    for (let i = 1; i < rows; i++) {
        MISBArray[i - 1] = new Array(MISBFields).fill(null);

        MISBArray[i - 1][MISB.UnixTimeStamp] = Number(csv[i][0])*1000;

        const postiion = csv[i][3].split(",");
        if (postiion.length !== 2) {
            showError("Invalid position format in FR24 CSV at row " + i);
            continue;
        }
        MISBArray[i - 1][MISB.SensorLatitude] = Number(postiion[0]);
        MISBArray[i - 1][MISB.SensorLongitude] = Number(postiion[1]);

        const altitude = f2m(Number(csv[i][4]));
        MISBArray[i - 1][MISB.SensorTrueAltitude] = isNaN(altitude) ? null : altitude;

        MISBArray[i - 1][MISB.PlatformTailNumber] = csv[i][2]; // Callsign

    }

    return MISBArray;
}


