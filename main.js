// Visor 3D de las poleras de Frank para ETM Day 2026.
// La persona viene de fuente/persona_mpfb.py (Blender + MPFB 2, polera simulada como tela). Los estampados se proyectan sobre la
// polera con DecalGeometry, así se cambian color y frase sin regenerar el modelo.
// Ejes: Y arriba, la persona mira hacia +Z. Unidades en metros.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const MOVIL = matchMedia('(max-width: 760px)').matches;

// Costura del cuello en el modelo; persona.json la trae medida desde la malla final
let CUELLO_FRENTE = 1.47;
let CUELLO_ESPALDA = 1.51;
// Radio aproximado del torso: un estampado de ancho w sobre la tela curva se ve, de frente, más angosto
const R_TORSO = 0.27;
const proyectado = (w) => 2 * R_TORSO * Math.sin(w / (2 * R_TORSO));
// La tela en pantalla: blanco algo apagado para que se vea el volumen
const TELA = { blanca: '#f2f1ee', negra: '#1d1c1b' };

// ------------------------------------------------------------ escena
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#ece6dc');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
// luz de estudio real (HDRI de Poly Haven, CC0)
new RGBELoader().load('assets/telas/studio_small_08_1k.hdr', (hdr) => {
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  scene.environmentIntensity = 0.75;
  hdr.dispose();
});

scene.add(new THREE.HemisphereLight('#fff7ee', '#b9ab98', 0.45));
const sol = new THREE.DirectionalLight('#fff4e6', 1.8);
sol.position.set(1.6, 3.2, 2.2);
sol.castShadow = true;
sol.shadow.mapSize.set(2048, 2048);
Object.assign(sol.shadow.camera, { left: -1.2, right: 1.2, top: 2.2, bottom: -0.3, near: 0.5, far: 8 });
sol.shadow.bias = -0.0004;
sol.shadow.normalBias = 0.02;
scene.add(sol);
const relleno = new THREE.DirectionalLight('#e9f0ff', 0.7);
relleno.position.set(-2.2, 1.6, -1.8);
scene.add(relleno);

// piso: disco suave y sombra
{
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(256, 256, 0, 256, 256, 256);
  grad.addColorStop(0, 'rgba(214,204,190,1)');
  grad.addColorStop(0.55, 'rgba(224,215,203,0.8)');
  grad.addColorStop(1, 'rgba(236,230,220,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  const disco = new THREE.Mesh(new THREE.CircleGeometry(1.6, 64),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  disco.rotation.x = -Math.PI / 2;
  scene.add(disco);
  const sombra = new THREE.Mesh(new THREE.CircleGeometry(1.6, 64), new THREE.ShadowMaterial({ opacity: 0.22 }));
  sombra.rotation.x = -Math.PI / 2;
  sombra.position.y = 0.001;
  sombra.receiveShadow = true;
  scene.add(sombra);
}

const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 50);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.55;
controls.maxDistance = 6;
controls.maxPolarAngle = Math.PI * 0.62;
controls.autoRotate = true;
controls.autoRotateSpeed = 1.2;
controls.enablePan = false;

const lejos = () => (camera.aspect < 0.8 ? 5.6 : 4.3);
const VISTAS = {
  frente: () => ({ pos: new THREE.Vector3(0, 1.15, lejos()), mira: new THREE.Vector3(0, MOVIL ? 0.8 : 0.95, 0) }),
  espalda: () => ({ pos: new THREE.Vector3(0, 1.15, -lejos()), mira: new THREE.Vector3(0, MOVIL ? 0.8 : 0.95, 0) }),
  detalle: () => ({ pos: new THREE.Vector3(0.3, 1.38, -1.6), mira: new THREE.Vector3(0, 1.24, 0) }),
};
let viaje = null;
function irA(nombre, dur = 1.1) {
  const v = VISTAS[nombre]();
  viaje = { p0: camera.position.clone(), m0: controls.target.clone(), p1: v.pos, m1: v.mira, t: 0, dur };
}
{
  const v = VISTAS.frente();
  camera.position.set(1.9, 1.2, lejos() * 0.9);
  controls.target.copy(v.mira);
}

// ------------------------------------------------------------ texturas
const loader = new THREE.TextureLoader();
const cache = new Map();
function textura(url) {
  if (!cache.has(url)) {
    cache.set(url, new Promise((ok, mal) => loader.load(url, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      ok(t);
    }, undefined, mal)));
  }
  return cache.get(url);
}

// ------------------------------------------------------------ persona y estampados
let datos, polera, decales = [];
const estado = { color: 'blanca', frase: null };

async function ponerEstampados() {
  const { color, frase } = estado;
  polera.material.color.set(TELA[color]);
  const fr = datos.frases.find((f) => f.id === frase);
  const [tFrente, tEspalda] = await Promise.all([
    textura(`assets/estampados/${color}-frente.png`),
    textura(`assets/estampados/${color}-${frase}.png`),
  ]);
  if (estado.color !== color || estado.frase !== frase) return;   // cambió mientras cargaba
  for (const d of decales) { scene.remove(d); d.geometry.dispose(); d.material.dispose(); }
  decales = [];
  const f = datos.frente, e = datos.espalda;
  decales.push(decal(tFrente, 'frente', proyectado(f.ancho), f.alto, CUELLO_FRENTE - f.bajo_cuello - f.alto / 2));
  decales.push(decal(tEspalda, 'espalda', proyectado(e.ancho), fr.alto, CUELLO_ESPALDA - e.bajo_cuello - fr.alto / 2));
  location.replace(`#${color}-${frase}`);
}

const ray = new THREE.Raycaster();
function decal(tex, lado, w, h, y) {
  const z = lado === 'frente' ? 1 : -1;
  ray.set(new THREE.Vector3(0, y, z * 1.5), new THREE.Vector3(0, 0, -z));
  const hit = ray.intersectObject(polera, false)[0];
  const rot = new THREE.Euler(0, lado === 'frente' ? 0 : Math.PI, 0);
  const geo = new DecalGeometry(polera, hit.point, rot, new THREE.Vector3(w, h, 0.16));
  const mat = new THREE.MeshStandardMaterial({
    map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
    roughness: 0.78, metalness: 0,
  });
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  scene.add(m);
  return m;
}

// ------------------------------------------------------------ interfaz
function armarUI() {
  const cCol = document.getElementById('colores');
  for (const c of datos.colores) {
    const b = document.createElement('button');
    b.dataset.color = c.id;
    b.innerHTML = `<i style="background:${c.tela}"></i>${c.nombre}`;
    b.onclick = () => { estado.color = c.id; marcar(); ponerEstampados(); };
    cCol.append(b);
  }
  const cFr = document.getElementById('frases');
  datos.frases.forEach((f, i) => {
    const b = document.createElement('button');
    b.dataset.frase = f.id;
    b.innerHTML = `<b>${i + 1}</b><span>${f.texto}</span>`;
    b.onclick = () => {
      estado.frase = f.id; marcar(); ponerEstampados();
      if (camera.position.z > -0.2) irA('espalda');
    };
    cFr.append(b);
  });
  document.querySelectorAll('[data-vista]').forEach((b) => (b.onclick = () => { girar(false); irA(b.dataset.vista); }));
  document.getElementById('girar').onclick = () => girar(!controls.autoRotate);
  controls.addEventListener('start', () => { viaje = null; girar(false); });
}
function marcar() {
  document.querySelectorAll('[data-color]').forEach((b) => b.classList.toggle('activo', b.dataset.color === estado.color));
  document.querySelectorAll('[data-frase]').forEach((b) => b.classList.toggle('activo', b.dataset.frase === estado.frase));
}
function girar(v) {
  controls.autoRotate = v;
  document.getElementById('girar').classList.toggle('on', v);
}

// ------------------------------------------------------------ carga
async function iniciar() {
  datos = await (await fetch('assets/estampados/datos.json')).json();
  estado.frase = datos.frases[0].id;
  const [c, f] = decodeURIComponent(location.hash.slice(1)).split(/-(.+)/);
  if (datos.colores.some((x) => x.id === c)) estado.color = c;
  if (datos.frases.some((x) => x.id === f)) estado.frase = f;

  const medidas = await (await fetch('assets/persona.json')).json();
  CUELLO_FRENTE = medidas.cuello_frente;
  CUELLO_ESPALDA = medidas.cuello_espalda;
  const punto = await textura('assets/telas/cotton_jersey_nor_gl_1k.jpg');
  punto.colorSpace = THREE.NoColorSpace;
  punto.wrapS = punto.wrapT = THREE.RepeatWrapping;
  punto.repeat.set(14, 14);
  const gltf = await new GLTFLoader().loadAsync('assets/persona.glb');
  const persona = gltf.scene;
  persona.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const n = o.material.name;
    // MPFB exporta todo como transparente: lo opaco va opaco y el pelo con recorte, si no se ordena mal
    const pelo = /short02|eyebrow|eyelash|high-poly/.test(n);
    o.material.transparent = false;
    o.material.depthWrite = true;
    o.material.alphaTest = pelo ? 0.45 : 0;
    if (!pelo) o.material.opacity = 1;
    if (pelo) { o.castShadow = false; o.material.side = THREE.DoubleSide; }
    if (n === 'polera') {
      polera = o;
      // punto de algodón (Cotton Jersey de Poly Haven, CC0)
      o.material.normalMap = punto;
      o.material.normalScale.set(0.6, 0.6);
      o.material.roughness = 0.95;
      o.material.side = THREE.DoubleSide;
    }
    if (n === 'jeans') o.material.side = THREE.DoubleSide;
  });
  scene.add(persona);
  persona.updateMatrixWorld(true);
  armarUI();
  marcar();
  await ponerEstampados();
  document.getElementById('carga').classList.add('fuera');
}
iniciar().catch((e) => {
  document.querySelector('#carga span').textContent = 'No se pudo cargar el visor.';
  console.error(e);
});

// ------------------------------------------------------------ bucle
const reloj = new THREE.Clock();
const suave = (t) => t * t * (3 - 2 * t);
renderer.setAnimationLoop(() => {
  const dt = Math.min(reloj.getDelta(), 0.05);
  if (viaje) {
    viaje.t = Math.min(1, viaje.t + dt / viaje.dur);
    const k = suave(viaje.t);
    // por la órbita, no a través de la persona
    const a0 = Math.atan2(viaje.p0.x, viaje.p0.z), a1 = Math.atan2(viaje.p1.x, viaje.p1.z);
    let da = a1 - a0;
    if (da > Math.PI) da -= 2 * Math.PI;
    if (da < -Math.PI) da += 2 * Math.PI;
    const r0 = Math.hypot(viaje.p0.x, viaje.p0.z), r1 = Math.hypot(viaje.p1.x, viaje.p1.z);
    const a = a0 + da * k, r = r0 + (r1 - r0) * k;
    camera.position.set(Math.sin(a) * r, viaje.p0.y + (viaje.p1.y - viaje.p0.y) * k, Math.cos(a) * r);
    controls.target.lerpVectors(viaje.m0, viaje.m1, k);
    if (viaje.t >= 1) viaje = null;
  }
  controls.update(dt);
  renderer.render(scene, camera);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
