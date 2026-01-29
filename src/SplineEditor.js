// e.g. in SitAguadilla.js:

import {PointEditor} from "./PointEditor";
import {BufferAttribute, BufferGeometry, CatmullRomCurve3, Line, LineBasicMaterial, Vector3} from "three";
import * as LAYER from "./LayerMasks";

export class   SplineEditor extends PointEditor{

    constructor(_scene, _camera, _renderer, controls, onChange, initialPoints, isLLA, curveType) {

        super(_scene, _camera, _renderer, controls, onChange, initialPoints, isLLA)


        // segments per arc (between control points) for rendering
        this.ARC_SEGMENTS = 200;
        this.minimumPoints = 4;


    // Load will reset the random initial positions to these
        this.load(initialPoints)


        // create a geometry for the curve, we clone this later
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.ARC_SEGMENTS * 3), 3));

        this.spline = new CatmullRomCurve3(this.positions);
        // Store curve type for linear mode support
        this.curveType = curveType;
        // 'chordal' gives a smooth velocity across the segment.
        this.spline.curveType = curveType === 'catmull' ? 'catmullrom' : curveType;
        this.spline.mesh = new Line(geometry.clone(), new LineBasicMaterial({
            color: 0x00ff00,
            opacity: 0.35
        }));
        this.spline.mesh.castShadow = true;

        this.spline.mesh.layers.mask = LAYER.MASK_HELPERS;

        this.scene.add(this.spline.mesh);

        this.updatePointEditorGraphics()

    }

    getLength(steps) {
        let len = 0;
        const lastPos = new Vector3()
        const pos = new Vector3()
        const spline = this.spline
        spline.getPoint(0,lastPos)

        for (let i=1;i<steps;i++){
            const t = i/(steps-1) // go from 0 to 1, so we need steps-1 for the last one
            spline.getPoint(t,pos)
            len += pos.clone().sub(lastPos).length()
            lastPos.copy(pos)
        }

        return len;
    }

    // get value at t (parametric input, 0..1) into the vector point
    getPoint(t,point) {
        if (this.curveType === 'linear' || this.numPoints < 2) {
            return super.getPoint(t, point);
        }
        return this.spline.getPoint(t,point)
    }


    updatePointEditorGraphics() {
        super.updatePointEditorGraphics()

        const point = new Vector3();
        const splineMesh = this.spline.mesh;
        const position = splineMesh.geometry.attributes.position;
        for (let i = 0; i < this.ARC_SEGMENTS; i++) {
            const t = i / (this.ARC_SEGMENTS - 1);
            this.getPoint(t, point);
            position.setXYZ(i, point.x, point.y, point.z);
        }
        position.needsUpdate = true;
    }

    setCurveType(type) {
        this.curveType = type;
        if (type !== 'linear') {
            this.spline.curveType = type === 'catmull' ? 'catmullrom' : type;
        }
        this.updatePointEditorGraphics();
    }

    /**
     * Clean up resources when the spline editor is disposed
     * Extends the base PointEditor dispose to also clean up the spline mesh
     */
    dispose() {
        // Clean up the spline mesh
        if (this.spline && this.spline.mesh) {
            this.scene.remove(this.spline.mesh);
            this.spline.mesh.geometry.dispose();
            this.spline.mesh.material.dispose();
        }

        // Call parent dispose to clean up position indicator and other resources
        super.dispose();
    }

}