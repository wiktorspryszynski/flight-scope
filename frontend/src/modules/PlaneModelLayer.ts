import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MaplibreMap } from 'maplibre-gl'
import { MercatorCoordinate } from 'maplibre-gl'

export type AnimatedPosition = {
  longitude: number
  latitude: number
  heading: number
}

const MODEL_URL = new URL('../assets/models/airbus_a319.glb', import.meta.url).href

// Scale: MercatorCoordinate units per meter at the equator
const METERS_PER_UNIT = MercatorCoordinate.fromLngLat([0, 0], 0).meterInMercatorCoordinateUnits()
// Display the model at ~80 m wingspan scale
const MODEL_SCALE = METERS_PER_UNIT * 80

export class PlaneModelLayer implements CustomLayerInterface {
  readonly id = 'plane-model'
  readonly type = 'custom' as const
  readonly renderingMode = '3d' as const

  private positionRef: { current: AnimatedPosition }
  private scene: THREE.Scene
  private camera: THREE.Camera
  private renderer!: THREE.WebGLRenderer
  private map!: MaplibreMap

  constructor(positionRef: { current: AnimatedPosition }) {
    this.positionRef = positionRef
    this.scene = new THREE.Scene()
    this.camera = new THREE.Camera()

    // Ambient + directional light for the model
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.9))
    const sun = new THREE.DirectionalLight(0xffffff, 0.8)
    sun.position.set(0, -70, 100).normalize()
    this.scene.add(sun)

    // Load the GLB
    const loader = new GLTFLoader()
    loader.load(
      MODEL_URL,
      (gltf) => {
        this.scene.add(gltf.scene)
      },
      undefined,
      (err) => console.error('[PlaneModelLayer] failed to load GLB:', err),
    )
  }

  onAdd(map: MaplibreMap, gl: WebGL2RenderingContext): void {
    this.map = map
    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: true,
    })
    this.renderer.autoClear = false
  }

  render(_gl: WebGL2RenderingContext | WebGLRenderingContext, options: CustomRenderMethodInput): void {
    const { longitude, latitude, heading } = this.positionRef.current

    // Convert geo position to Mercator coordinate at altitude 0
    const mc = MercatorCoordinate.fromLngLat([longitude, latitude], 0)

    // Build transform: scale → rotate (heading) → translate to Mercator position
    const rotY = THREE.MathUtils.degToRad(heading)
    const transform = new THREE.Matrix4()
      .makeTranslation(mc.x, mc.y, mc.z ?? 0)
      .multiply(new THREE.Matrix4().makeRotationY(-rotY))
      .multiply(new THREE.Matrix4().makeScale(MODEL_SCALE, -MODEL_SCALE, MODEL_SCALE))

    // Compose with MapLibre's projection matrix (mat4 → number[] via Array.from)
    const projMatrix = new THREE.Matrix4().fromArray(Array.from(options.defaultProjectionData.mainMatrix))
    this.camera.projectionMatrix = projMatrix.multiply(transform)

    this.renderer.resetState()
    this.renderer.render(this.scene, this.camera)
    this.map.triggerRepaint()
  }
}
