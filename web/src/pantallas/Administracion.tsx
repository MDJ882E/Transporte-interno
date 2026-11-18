// Usuarios y cuentas. El jefe de sede gestiona el personal operativo de su sede; el administrador, todo.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ROL_NOMBRE, ROLES, type Maestros, type Rol, type Sesion } from '@shared/dominio';
import { api, ErrorApi, post } from '../lib/api';

interface Usuario {
  id: number;
  documento: string;
  nombre: string;
  rol: Rol;
  sede_id: string | null;
  activo: boolean;
  codigo_barras: string | null;
}

interface Cuenta {
  codigo: string;
  nombre: string;
  activo: boolean;
}

export function Administracion(props: { sesion: Sesion; maestros: Maestros }) {
  const esAdmin = props.sesion.usuario.rol === 'admin';
  const roles: Rol[] = esAdmin ? [...ROLES] : ['transportador', 'lider_corte', 'recibidor'];
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [nuevo, setNuevo] = useState({
    documento: '',
    nombre: '',
    rol: 'transportador' as Rol,
    sede_id: props.sesion.usuario.sede_id ?? props.maestros.sedes[0]?.id ?? '',
    pin: '',
    codigo_barras: '',
  });
  const [cuenta, setCuenta] = useState({ codigo: '', nombre: '' });

  const cargar = useCallback(async () => {
    const [u, c] = await Promise.all([api<Usuario[]>('/api/usuarios'), api<Cuenta[]>('/api/cuentas')]);
    setUsuarios(u);
    setCuentas(c);
  }, []);
  useEffect(() => void cargar().catch(() => setMensaje({ ok: false, texto: 'Sin conexión.' })), [cargar]);

  async function ejecutar(accion: () => Promise<unknown>, ok: string) {
    try {
      await accion();
      setMensaje({ ok: true, texto: ok });
      await cargar();
      return true;
    } catch (e) {
      setMensaje({ ok: false, texto: e instanceof ErrorApi ? e.message : 'No se pudo guardar.' });
      return false;
    }
  }

  async function crearUsuario(e: FormEvent) {
    e.preventDefault();
    const global = nuevo.rol === 'gerencia' || nuevo.rol === 'admin';
    const hecho = await ejecutar(
      () =>
        post('/api/usuarios', {
          ...nuevo,
          sede_id: global ? null : nuevo.sede_id,
          codigo_barras: nuevo.codigo_barras.trim() || null,
        }),
      `Usuario ${nuevo.nombre} creado.`,
    );
    if (hecho) setNuevo({ ...nuevo, documento: '', nombre: '', pin: '', codigo_barras: '' });
  }

  const patch = (ruta: string, cuerpo: unknown) =>
    api(ruta, { method: 'PATCH', body: JSON.stringify(cuerpo) });

  return (
    <main className="contenedor ancho pila">
      <h1>Usuarios y cuentas</h1>
      {mensaje && <div className={`aviso ${mensaje.ok ? 'ok' : 'error'}`}>{mensaje.texto}</div>}

      <form className="tarjeta pila" onSubmit={crearUsuario}>
        <h2>Nuevo usuario</h2>
        <div className="kpis">
          <label>
            Documento
            <input
              inputMode="numeric"
              value={nuevo.documento}
              onChange={(e) => setNuevo({ ...nuevo, documento: e.target.value })}
              required
            />
          </label>
          <label>
            Nombre
            <input
              value={nuevo.nombre}
              onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
              required
            />
          </label>
          <label>
            Rol
            <select value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value as Rol })}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {ROL_NOMBRE[r]}
                </option>
              ))}
            </select>
          </label>
          {esAdmin && nuevo.rol !== 'gerencia' && nuevo.rol !== 'admin' && (
            <label>
              Sede
              <select value={nuevo.sede_id} onChange={(e) => setNuevo({ ...nuevo, sede_id: e.target.value })}>
                {props.maestros.sedes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            PIN inicial (4 a 6 dígitos)
            <input
              inputMode="numeric"
              pattern="\d{4,6}"
              maxLength={6}
              value={nuevo.pin}
              onChange={(e) => setNuevo({ ...nuevo, pin: e.target.value.replace(/\D/g, '') })}
              required
            />
          </label>
          {nuevo.rol === 'transportador' && (
            <label>
              Código en poscosecha
              <input
                value={nuevo.codigo_barras}
                onChange={(e) => setNuevo({ ...nuevo, codigo_barras: e.target.value })}
              />
            </label>
          )}
        </div>
        <button className="boton primario">Crear usuario</button>
      </form>

      <section className="pila">
        <h2>Usuarios ({usuarios.length})</h2>
        <div className="tabla-envoltura">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Documento</th>
                <th>Rol</th>
                <th>Sede</th>
                <th>Código poscosecha</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => (
                <tr key={u.id} style={{ opacity: u.activo ? 1 : 0.55 }}>
                  <td>{u.nombre}</td>
                  <td>{u.documento}</td>
                  <td>{ROL_NOMBRE[u.rol]}</td>
                  <td>{u.sede_id ?? 'Todas'}</td>
                  <td>
                    {u.rol === 'transportador' && (
                      <button
                        className="enlace"
                        onClick={() => {
                          const codigo = prompt(
                            `Código de ${u.nombre} en el sistema de poscosecha`,
                            u.codigo_barras ?? '',
                          );
                          if (codigo?.trim())
                            void ejecutar(
                              () => patch(`/api/usuarios/${u.id}`, { codigo_barras: codigo.trim() }),
                              'Código guardado.',
                            );
                        }}
                      >
                        {u.codigo_barras ?? 'Asignar'}
                      </button>
                    )}
                  </td>
                  <td>{u.activo ? 'Activo' : 'Inactivo'}</td>
                  <td className="fila">
                    <button
                      className="enlace"
                      onClick={() => {
                        const pin = prompt(`Nuevo PIN para ${u.nombre} (4 a 6 dígitos)`);
                        if (pin && /^\d{4,6}$/.test(pin))
                          void ejecutar(() => patch(`/api/usuarios/${u.id}`, { pin }), 'PIN cambiado.');
                      }}
                    >
                      Cambiar PIN
                    </button>
                    <button
                      className="enlace"
                      onClick={() =>
                        void ejecutar(
                          () => patch(`/api/usuarios/${u.id}`, { activo: !u.activo }),
                          'Estado actualizado.',
                        )
                      }
                    >
                      {u.activo ? 'Desactivar' : 'Activar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="tarjeta pila">
        <h2>Cuentas o clientes de los baldes</h2>
        <form
          className="fila"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await ejecutar(() => post('/api/cuentas', cuenta), `Cuenta ${cuenta.nombre} guardada.`))
              setCuenta({ codigo: '', nombre: '' });
          }}
        >
          <input
            placeholder="Código"
            value={cuenta.codigo}
            onChange={(e) => setCuenta({ ...cuenta, codigo: e.target.value })}
            required
            aria-label="Código de la cuenta"
          />
          <input
            placeholder="Nombre"
            value={cuenta.nombre}
            onChange={(e) => setCuenta({ ...cuenta, nombre: e.target.value })}
            required
            aria-label="Nombre de la cuenta"
            style={{ flex: 1 }}
          />
          <button className="boton">Agregar</button>
        </form>
        <div className="fila">
          {cuentas.map((c) => (
            <button
              key={c.codigo}
              className="opcion"
              aria-pressed={c.activo}
              title={c.activo ? 'Tocar para desactivar' : 'Tocar para activar'}
              onClick={() =>
                void ejecutar(
                  () => patch(`/api/cuentas/${encodeURIComponent(c.codigo)}`, { activo: !c.activo }),
                  'Cuenta actualizada.',
                )
              }
            >
              {c.nombre} ({c.codigo})
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
