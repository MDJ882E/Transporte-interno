import { useState } from 'react';
import type { Maestros } from '@shared/dominio';
import { ahoraIso, nuevoId, registrar } from '../lib/registro';
import { Hoja, Opciones } from '../ui';

export function ReportarFalla(props: {
  maestros: Maestros;
  sede: string;
  puntoId?: number | null;
  alCerrar: () => void;
}) {
  const medio = props.maestros.sedes.find((s) => s.id === props.sede)?.medio;
  const tipos = props.maestros.tipos_falla.filter((t) => !t.medio || t.medio === medio);
  const [tipo, setTipo] = useState<string | null>(null);
  const [descripcion, setDescripcion] = useState('');

  async function enviar() {
    if (!tipo) return;
    await registrar({
      tipo: 'falla',
      id: nuevoId(),
      recurso_id: null,
      punto_id: props.puntoId ?? null,
      tipo_falla: tipo,
      descripcion: descripcion.trim() || null,
      inicio: ahoraIso(),
    });
    props.alCerrar();
  }

  return (
    <Hoja titulo="Reportar falla" alCerrar={props.alCerrar}>
      <Opciones
        opciones={tipos.map((t) => ({ valor: t.codigo, texto: t.nombre }))}
        elegida={tipo}
        alElegir={setTipo}
      />
      <label>
        Detalle (opcional)
        <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} maxLength={200} />
      </label>
      <button className="boton primario bloque" disabled={!tipo} onClick={enviar}>
        Reportar
      </button>
    </Hoja>
  );
}
