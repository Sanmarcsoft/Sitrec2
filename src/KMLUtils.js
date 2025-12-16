// parseXML from https://stackoverflow.com/questions/4200913/xml-to-javascript-object
import {CTrackFile} from "./TrackFiles/CTrackFile";
import {CTrackFileKML} from "./TrackFiles/CTrackFileKML";
import {CTrackFileXML} from "./TrackFiles/CTrackFileXML";
import {CTrackFileSRT, SRT} from "./TrackFiles/CTrackFileSRT";

export {CTrackFile, CTrackFileKML, CTrackFileXML, CTrackFileSRT, SRT};

export function parseSRT(data) {
    const srtFile = new CTrackFileSRT(data);
    return srtFile.toMISB();
}

export function parseXml(xml, arrayTags)
{
    let dom = null;
    if (window.DOMParser)
    {
        dom = (new DOMParser()).parseFromString(xml, "text/xml");
    }
    else if (window.ActiveXObject)
    {
        dom = new ActiveXObject('Microsoft.XMLDOM');
        dom.async = false;
        if (!dom.loadXML(xml))
        {
            throw new Error(dom.parseError.reason + " " + dom.parseError.srcText);
        }
    }
    else
    {
        throw new Error("cannot parse xml string!");
    }

    function isArray(o)
    {
        return Array.isArray(o);
    }

    function parseNode(xmlNode, result)
    {
        if (xmlNode.nodeName === "#text") {
            const v = xmlNode.nodeValue;
            if (v.trim()) {
                result['#text'] = v;
//                    result = v;
            }
            return;
        }

        const jsonNode = {};
        const existing = result[xmlNode.nodeName];
        if(existing)
        {
            if(!isArray(existing))
            {
                result[xmlNode.nodeName] = [existing, jsonNode];
            }
            else
            {
                result[xmlNode.nodeName].push(jsonNode);
            }
        }
        else
        {
            if(arrayTags && arrayTags.includes(xmlNode.nodeName))
            {
                result[xmlNode.nodeName] = [jsonNode];
            }
            else
            {
                result[xmlNode.nodeName] = jsonNode;
            }
        }

        if(xmlNode.attributes)
        {
            const length = xmlNode.attributes.length;
            for(let i = 0; i < length; i++)
            {
                const attribute = xmlNode.attributes[i];
                jsonNode[attribute.nodeName] = attribute.nodeValue;
            }
        }

        const length2 = xmlNode.childNodes.length;
        for(let i = 0; i < length2; i++)
        {
            parseNode(xmlNode.childNodes[i], jsonNode);
        }
    }

    const result = {};
    for (let i = 0; i < dom.childNodes.length; i++)
    {
        parseNode(dom.childNodes[i], result);
    }

    return result;
}

export function doesKMLContainTrack(kml) {
    let trackFile;
    if (kml instanceof CTrackFileKML) {
        trackFile = kml;
    } else {
        trackFile = new CTrackFileKML(kml);
    }
    return trackFile.doesContainTrack();
}

/*
time(millisecond)
datetime(utc)
latitude
longitude
height_above_takeoff(feet)
height_above_ground_at_drone_location(feet)
ground_elevation_at_drone_location(feet)
altitude_above_seaLevel(feet)
height_sonar(feet)
speed(mph)
distance(feet)
mileage(feet)
satellites
gpslevel
voltage(v)
max_altitude(feet)
max_ascent(feet)
max_speed(mph)
max_distance(feet)
xSpeed(mph)
ySpeed(mph)
zSpeed(mph)
compass_heading(degrees)
pitch(degrees)
roll(degrees)
isPhoto
isVideo
rc_elevator
rc_aileron
rc_throttle
rc_rudder
rc_elevator(percent)
rc_aileron(percent)
rc_throttle(percent)
rc_rudder(percent)
gimbal_heading(degrees)
gimbal_pitch(degrees)
gimbal_roll(degrees)
battery_percent
voltageCell1
voltageCell2
voltageCell3
voltageCell4
voltageCell5
voltageCell6
current(A)
battery_temperature(f)
altitude(feet)
ascent(feet)
flycStateRaw
flycState
message
*/


export function KMLToMISB(kml, trackIndex = 0) {
    let trackFile;
    if (kml instanceof CTrackFileKML) {
        trackFile = kml;
    } else {
        trackFile = new CTrackFileKML(kml);
    }
    return trackFile.toMISB(trackIndex);
}

///////////////////////////////////////////////////
// XML like STANAG

export function doesXMLContainTrack(xml) {
    let trackFile;
    if (xml instanceof CTrackFileXML) {
        trackFile = xml;
    } else {
        trackFile = new CTrackFileXML(xml);
    }
    return trackFile.doesContainTrack();
}

export function XMLToMISB(xml, trackIndex = 0) {
    let trackFile;
    if (xml instanceof CTrackFileXML) {
        trackFile = xml;
    } else {
        trackFile = new CTrackFileXML(xml);
    }
    return trackFile.toMISB(trackIndex);
}
