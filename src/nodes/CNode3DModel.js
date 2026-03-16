// CNode3DModel.js - CNode3DModel
// a 3D model node with the model loaded from a file
import {CNode3DGroup} from "./CNode3DGroup";
import {FileManager} from "../Globals";
import {disposeScene} from "../threeExt";
import {parseModelData} from "../ModelLoader";

export class CNode3DModel extends CNode3DGroup {
    constructor(v) {
        super(v);

        const data = FileManager.get(v.TargetObjectFile ?? "TargetObjectFile")
        const filename = v.TargetObjectFile ?? "TargetObjectFile"

        parseModelData(filename, data, (modelAsset) => {
            this.model = modelAsset.scene
            this.model.scale.setScalar(1);
            this.model.visible = true
            this.group.add(this.model)
        }, (error) => {
            console.error("Error parsing model:", filename, error);
        })

    }

    dispose()
    {
        this.group.remove(this.model)
        disposeScene(this.model)
        this.model = undefined
        super.dispose()
    }

    modSerialize() {
        return {
            ...super.modSerialize(),
            tiltType: this.tiltType,
        }
    }

    modDeserialize(v) {
        super.modDeserialize(v)
        this.tiltType = v.tiltType
    }

    update(f) {
        super.update(f)
        this.recalculate() // every frame so scale is correct after the jet loads

    }

    recalculate() {
        super.recalculate()
        this.propagateLayerMask()

    }

}
