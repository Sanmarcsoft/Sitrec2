import {MISB, MISBFields} from "./MISBFields";
import {assert} from "./assert";

export class CGeoJSON {

    constructor() {
        this.json = {
            type: "FeatureCollection",
            totalFeatures: 0,
            features: [],
        }
    }

    // Example of a point in the geoJSON
// {
//     "type": "Feature",
//     "id": "FNJANJANJFSANNFJSA_thesearejustpointids",
//     "geometry": {
//         "type": "Point",
//         "coordinates": [30.1234, -85.1234, 1000.1234]
//     },
//     "geometry_name": "Location",
//     "properties": {
//         "thresherId": "dfjlsadjfjdsafjsdjkfls"
//         "dtg": "2024-02-24T16:40:00.123Z",
//         "lat": 30.1234567890123,
//         "lon": -85.1234567890123,
//         "alt": 1000.12345678901,
//         "otherProp": "hello"
//     }
// },

    addPoint(trackID, lat, lon, alt, datetime) {
        this.json.features.push({
            type: "Feature",
            id: trackID + "_" + this.json.totalFeatures,
            geometry: {
                type: "Point",
                coordinates: [lat, lon, alt],
            },
            geometry_name: "Location",
            properties: {
                thresherId: trackID,
                dtg: new Date(datetime).toISOString(),
                lat: lat,
                lon: lon,
                alt: alt,
                otherProp: "sitrec"
            }
        });
        this.json.totalFeatures++;
    }


    countTracks() {
        this.json.totalFeatures = this.json.features.length
        assert(this.json.totalFeatures > 0, "No features in geoJSON");
        this.thresherIds = new Set();
        for (let i = 0; i < this.json.totalFeatures; i++) {
            const feature = this.json.features[i];
            if (feature?.properties?.thresherId) {
                this.thresherIds.add(feature.properties.thresherId);
            }
        }
        return this.thresherIds.size;
    }

    // get the trackID of the indexed track
    // this is used by findShortName in the TrackManager
    shortTrackIDForIndex(trackIndex = 0) {
        const tracks = this.countTracks();
        console.assert(tracks > trackIndex, "Not enough tracks to get track " + trackIndex + " of " + tracks);

        const thresherID = Array.from(this.thresherIds)[trackIndex];

        // find the first feature with that thresherID
        // then from the properties, return the first available of:
        //   1. tailNumber (if not empty when stripped of whitespace)
        //   2. aircraftType (if not empty when stripped of whitespace)
        //   3. thresherId
        for (let i = 0; i < this.json.totalFeatures; i++) {
            const feature = this.json.features[i];
            if (!feature?.properties) continue;
            if (feature.properties.thresherId === thresherID) {
                const tailNumber = feature.properties.tailNumber;
                if (tailNumber && tailNumber.trim() !== "") {
                    return tailNumber;
                }
                const aircraftType = feature.properties.aircraftType;
                if (aircraftType && aircraftType.trim() !== "") {
                    return aircraftType;
                } else {
                    return thresherID.substring(0, 16);
                }
            }
        }




    }


    // extract a single track from the geoJSON and return it as an array of MISB data
    // sort the array by time stamp (probabyl not needed, but it's a good idea to be more robust)
    toMISB(trackIndex = 0) {

        // ignore the value in this.json.totalFeatures, as it's not always accurate
        // generate it from the length of the features array
        this.json.totalFeatures = this.json.features.length
        assert(this.json.totalFeatures > 0, "No features in geoJSON");


        const tracks = this.countTracks();
        console.assert(tracks > trackIndex, "Not enough tracks to export track " + trackIndex + " of " + tracks);

        // get the id of the indexed track from the set of thresherIds
        const trackID = Array.from(this.thresherIds)[trackIndex];


        const misb = []
        // iterate over the features in the geoJSON
        // if the thresherId matches the trackID, add it to the misb array
        let trackPointIndex = 0;
        for (let i = 0; i < this.json.totalFeatures; i++) {
            const feature = this.json.features[i];
            if (!feature?.properties) continue;
            if (feature.properties.thresherId === trackID) {
                const lat = feature.properties.lat;
                const lon = feature.properties.lon;
                const alt = feature.properties.alt;
                const _time = new Date(feature.properties.dtg).getTime();
                misb[trackPointIndex] = new Array(MISBFields);
                misb[trackPointIndex][MISB.UnixTimeStamp] = _time
                misb[trackPointIndex][MISB.SensorLatitude] = lat
                misb[trackPointIndex][MISB.SensorLongitude] = lon
                misb[trackPointIndex][MISB.SensorTrueAltitude] = alt
                trackPointIndex++;
            }
        }

        // sort the loaded misb array by time stamp (in ms)
        misb.sort((a, b) => a[MISB.UnixTimeStamp] - b[MISB.UnixTimeStamp]);

        return misb
    }


}
