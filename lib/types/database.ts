/**
 * Tipos TypeScript del schema Staffing Hub.
 * Sincronizados manualmente con fase1_schema.sql.
 *
 * TIP: Una vez conectado a Supabase puedes regenerar con:
 *   npx supabase gen types typescript --project-id TU_PROJECT_ID > lib/types/database.ts
 *
 * NOTA: @supabase/supabase-js ≥ 2.49 requiere que cada tabla/vista
 *       incluya `Relationships: []` para satisfacer `GenericTable`.
 */

// ─────────────────────────────────────────────────────────────
//  ENUMS / literales del dominio
// ─────────────────────────────────────────────────────────────

export type RolSistema = "proposer" | "admin";

/**
 * Ciclo de vida del acceso al sistema de una persona.
 *  - null         → la persona no tiene acceso (solo recurso de staffing)
 *  - "invitada"   → invitación enviada, falta que defina su contraseña
 *  - "activa"     → la persona ya tiene acceso a la plataforma
 *  - "suspendida" → un admin desactivó el acceso (conserva el rol)
 */
export type EstadoAcceso = "invitada" | "activa" | "suspendida";

export type EstadoEngagement = "activo" | "terminado";

export type TipoEngagement = "propuesta" | "proyecto" | "ayuda_interna";

export type EstadoPropuesta = "borrador" | "aprobada" | "rechazada";

export type EstadoAsignacion = "activa" | "finalizada" | "cancelada";

export type TipoAusencia =
  | "vacaciones_confirmadas"
  | "vacaciones_por_confirmar"
  | "permiso_sin_goce"
  | "dia_post_proyecto"
  | "dia_beneficio"
  | "dia_administrativo"
  | "otro";

// ─────────────────────────────────────────────────────────────
//  TABLAS — Row types (lo que devuelve SELECT)
// ─────────────────────────────────────────────────────────────

/** config_cargo: id, nombre, excluido_capacidad, presencia_minima_default, created_at, updated_at */
export interface ConfigCargo {
  id: string;
  nombre: string;
  excluido_capacidad: boolean;
  presencia_minima_default: number;
  created_at: string;
  updated_at: string;
}

/** cat_industria: id, nombre, activo, created_at */
export interface CatIndustria {
  id: string;
  nombre: string;
  activo: boolean;
  created_at: string;
}

/** cat_capacidad: id, nombre, activo, created_at (NO tiene columna 'categoria') */
export interface CatCapacidad {
  id: string;
  nombre: string;
  activo: boolean;
  created_at: string;
}

/** cat_tematica: id, nombre, activo, created_at */
export interface CatTematica {
  id: string;
  nombre: string;
  activo: boolean;
  created_at: string;
}

/**
 * persona: id, auth_user_id, nombre, apellido, email, cargo_actual,
 *          rol_sistema, activo, fecha_ingreso, created_at, updated_at
 * NOTA: NO tiene columna 'notas' ni 'cargo_id_actual'
 */
export interface Persona {
  id: string;
  auth_user_id: string | null;
  nombre: string;
  apellido: string;
  email: string;
  cargo_actual: string | null;
  rol_sistema: RolSistema | null;
  acceso_estado: EstadoAcceso | null;
  activo: boolean;
  fecha_ingreso: string | null;
  mentor_id: string | null;
  talento_potencial: number | null;
  talento_desempeno: number | null;
  fecha_nacimiento: string | null;
  is_leverager: boolean;
  is_ex_houser: boolean;
  is_deleted: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

// Persona con nombre completo (helper de UI)
export type PersonaConNombre = Persona & {
  nombre_completo: string;
};

/**
 * persona_cargo_historial: id, persona_id, cargo (text), fecha_inicio, fecha_fin, created_at
 * NOTA: usa 'cargo' (texto referencia a config_cargo.nombre), NO 'cargo_id'
 */
export interface PersonaCargoHistorial {
  id: string;
  persona_id: string;
  cargo: string;           // text reference a config_cargo(nombre)
  fecha_inicio: string;
  fecha_fin: string | null;
  created_at: string;
}

export interface PersonaIndustria {
  persona_id: string;
  industria_id: string;
  created_at: string;
}

export interface PersonaCapacidad {
  persona_id: string;
  capacidad_id: string;
  nivel: "basico" | "intermedio" | "avanzado" | null;
  created_at: string;
}

export interface PersonaTematica {
  persona_id: string;
  tematica_id: string;
  created_at: string;
}

/**
 * engagement: id, nombre, cliente, descripcion, industria_id, tipo, estado,
 *             fecha_inicio, fecha_fin_estimada, fecha_fin_real,
 *             propuesta_origen_id, color, created_by, created_at, updated_at
 */
export interface Engagement {
  id: string;
  nombre: string;
  cliente: string;
  tipo: TipoEngagement;
  estado: EstadoEngagement;
  industria_id: string | null;
  descripcion: string | null;
  fecha_inicio: string | null;
  fecha_fin_estimada: string | null;
  fecha_fin_real: string | null;
  propuesta_origen_id: string | null;
  color: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
  deleted_at: string | null;
}

/**
 * requerimiento_engagement: id, engagement_id, fase_nombre,
 *   cargo_requerido (text|null), pct_dedicacion, fecha_inicio, fecha_fin,
 *   descripcion, created_at
 * NOTA: usa 'cargo_requerido' (text), NO 'cargo_id'.
 */
export interface RequerimientoEngagement {
  id: string;
  engagement_id: string;
  fase_nombre: string | null;
  cargo_requerido: string | null;   // NULL = cualquier cargo
  pct_dedicacion: number;
  fecha_inicio: string;
  fecha_fin: string;
  descripcion: string | null;
  created_at: string;
}

/**
 * propuesta_plan: agrupa múltiples asignacion_propuesta en un escenario.
 * La aprobación opera sobre el plan completo, creando todas las asignaciones.
 */
export interface PropuestaPlan {
  id: string;
  nombre: string;
  descripcion: string | null;
  estado: EstadoPropuesta;
  creada_por: string | null;
  created_at: string;
  updated_at: string;
  revisado_por: string | null;
  fecha_revision: string | null;
  notas_revision: string | null;
}

/**
 * asignacion_propuesta: id, plan_id (FK propuesta_plan), propuesto_por,
 *   persona_id, engagement_id, requerimiento_id, pct_dedicacion,
 *   cargo_al_momento, fecha_inicio, fecha_fin, estado, revisado_por,
 *   fecha_revision, notas_revision, asignacion_resultante_id, notas,
 *   created_at, updated_at
 * NOTA: el campo de notas del proposer es 'notas', NO 'notas_propuesta'
 */
export interface AsignacionPropuesta {
  id: string;
  plan_id: string | null;            // FK a propuesta_plan
  propuesto_por: string | null;      // nullable (sistema sin auth)
  persona_id: string;
  engagement_id: string;
  requerimiento_id: string | null;
  pct_dedicacion: number;
  cargo_al_momento: string | null;
  fecha_inicio: string;
  fecha_fin: string;
  estado: EstadoPropuesta;
  revisado_por: string | null;
  fecha_revision: string | null;
  notas_revision: string | null;
  asignacion_resultante_id: string | null;
  notas: string | null;              // notas del proposer
  created_at: string;
  updated_at: string;
}

/**
 * asignacion: id, persona_id, engagement_id, requerimiento_id, cargo_al_momento,
 *   pct_dedicacion, fecha_inicio, fecha_fin, estado, propuesta_origen_id,
 *   aprobada_por, fecha_aprobacion, notas, created_at, updated_at
 */
export interface Asignacion {
  id: string;
  persona_id: string;
  engagement_id: string;
  requerimiento_id: string | null;
  cargo_al_momento: string;           // NOT NULL en schema
  pct_dedicacion: number;
  fecha_inicio: string;
  fecha_fin: string | null;
  estado: EstadoAsignacion;
  propuesta_origen_id: string | null;
  aprobada_por: string | null;
  fecha_aprobacion: string | null;
  notas: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * asignacion_historial: id, asignacion_id, accion, campo_modificado,
 *   valor_anterior, valor_nuevo, realizado_por, created_at
 * NOTA: usa 'asignacion_id' (NOT NULL FK a asignacion), NO 'asignacion_resultante_id'
 */
export interface AsignacionHistorial {
  id: string;
  asignacion_id: string;
  accion: "creada" | "modificada" | "finalizada" | "cancelada";
  campo_modificado: string | null;
  valor_anterior: string | null;
  valor_nuevo: string | null;
  realizado_por: string | null;
  created_at: string;
}

export interface Ausencia {
  id: string;
  persona_id: string;
  tipo: TipoAusencia;
  fecha_inicio: string;
  fecha_fin: string;
  dias_habiles: number | null;
  descripcion: string | null;
  /** "manual" | "importacion_buk" — por defecto "manual" */
  fuente: "manual" | "importacion_buk";
  created_at: string;
}

// ─────────────────────────────────────────────────────────────
//  VISTAS — columnas exactas según el schema
// ─────────────────────────────────────────────────────────────

/**
 * Vista ocupacion_semana
 * Una fila por (persona × semana). Ventana: 26 semanas desde hoy.
 */
export interface OcupacionSemana {
  persona_id: string;
  persona_nombre: string;             // nombre || ' ' || apellido
  cargo_actual: string;
  semana_inicio: string;              // date ISO (lunes de la semana)
  semana_iso: string;                 // 'IYYY-IW' e.g. '2026-W15'
  ocupacion_actual_pct: number;       // solo asignaciones activas
  ocupacion_proyectada_pct: number;   // activas + borradores
}

/**
 * Vista cobertura_engagement
 * Una fila por requerimiento con su % cubierto vs requerido.
 */
export interface CoberturaEngagement {
  engagement_id: string;
  engagement_nombre: string;
  cliente: string;
  engagement_estado: EstadoEngagement;
  requerimiento_id: string;
  fase_nombre: string | null;
  cargo_requerido: string | null;
  pct_requerido: number;
  req_fecha_inicio: string;
  req_fecha_fin: string;
  pct_cubierto: number;
  pct_descubierto: number;            // > 0 → alerta de cobertura incompleta
}

// ─────────────────────────────────────────────────────────────
//  DATABASE — tipo raíz para el cliente Supabase tipado
//
//  IMPORTANTE: @supabase/supabase-js ≥ 2.49 requiere que cada
//  tabla/vista incluya `Relationships: []` para cumplir con
//  GenericTable / GenericView. Sin este campo el cliente infiere
//  todo como `never`.
// ─────────────────────────────────────────────────────────────

export type Database = {
  public: {
    Tables: {
      config_cargo: {
        Row: ConfigCargo;
        Insert: Omit<ConfigCargo, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<ConfigCargo, "id" | "created_at" | "updated_at">>;
        Relationships: [];
      };
      cat_industria: {
        Row: CatIndustria;
        Insert: Omit<CatIndustria, "id" | "created_at">;
        Update: Partial<Omit<CatIndustria, "id" | "created_at">>;
        Relationships: [];
      };
      cat_capacidad: {
        Row: CatCapacidad;
        Insert: Omit<CatCapacidad, "id" | "created_at">;
        Update: Partial<Omit<CatCapacidad, "id" | "created_at">>;
        Relationships: [];
      };
      cat_tematica: {
        Row: CatTematica;
        Insert: Omit<CatTematica, "id" | "created_at">;
        Update: Partial<Omit<CatTematica, "id" | "created_at">>;
        Relationships: [];
      };
      persona: {
        Row: Persona;
        Insert: Omit<Persona, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<Persona, "id" | "created_at" | "updated_at">>;
        Relationships: [];
      };
      persona_cargo_historial: {
        Row: PersonaCargoHistorial;
        Insert: Omit<PersonaCargoHistorial, "id" | "created_at">;
        Update: Partial<Omit<PersonaCargoHistorial, "id" | "created_at">>;
        Relationships: [];
      };
      persona_industria: {
        Row: PersonaIndustria;
        Insert: Omit<PersonaIndustria, "created_at">;
        Update: Partial<Omit<PersonaIndustria, "created_at">>;
        Relationships: [];
      };
      persona_capacidad: {
        Row: PersonaCapacidad;
        Insert: Omit<PersonaCapacidad, "created_at">;
        Update: Partial<Omit<PersonaCapacidad, "created_at">>;
        Relationships: [];
      };
      persona_tematica: {
        Row: PersonaTematica;
        Insert: Omit<PersonaTematica, "created_at">;
        Update: Partial<Omit<PersonaTematica, "created_at">>;
        Relationships: [];
      };
      engagement: {
        Row: Engagement;
        Insert: Omit<Engagement, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<Engagement, "id" | "created_at" | "updated_at">>;
        Relationships: [];
      };
      requerimiento_engagement: {
        Row: RequerimientoEngagement;
        Insert: Omit<RequerimientoEngagement, "id" | "created_at">;
        Update: Partial<Omit<RequerimientoEngagement, "id" | "created_at">>;
        Relationships: [];
      };
      propuesta_plan: {
        Row: PropuestaPlan;
        Insert: Omit<PropuestaPlan, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<PropuestaPlan, "id" | "created_at" | "updated_at">>;
        Relationships: [];
      };
      asignacion_propuesta: {
        Row: AsignacionPropuesta;
        Insert: Omit<AsignacionPropuesta, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<AsignacionPropuesta, "id" | "created_at" | "updated_at">>;
        Relationships: [];
      };
      asignacion: {
        Row: Asignacion;
        Insert: Omit<Asignacion, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<Asignacion, "id" | "created_at" | "updated_at">>;
        Relationships: [];
      };
      asignacion_historial: {
        Row: AsignacionHistorial;
        Insert: Omit<AsignacionHistorial, "id" | "created_at">;
        Update: never;  // solo INSERT permitido (auditoría inmutable)
        Relationships: [];
      };
      ausencia: {
        Row: Ausencia;
        Insert: Omit<Ausencia, "id" | "created_at" | "fuente"> & { fuente?: "manual" | "importacion_buk" };
        Update: Partial<Omit<Ausencia, "id" | "created_at">>;
        Relationships: [];
      };
    };
    Views: {
      ocupacion_semana: {
        Row: OcupacionSemana;
        Relationships: [];
      };
      cobertura_engagement: {
        Row: CoberturaEngagement;
        Relationships: [];
      };
    };
    Functions: {
      get_rol_usuario: {
        Args: Record<string, never>;
        Returns: RolSistema | null;
      };
      /**
       * check_capacidad_disponible(p_persona_id, p_fecha_inicio, p_fecha_fin, p_excluir_id?)
       * Retorna breakpoints con ocupacion_pct actual (sin incluir la nueva propuesta).
       * Uso: MAX(ocupacion_pct) + nueva_pct <= 100 para validar antes de aprobar.
       */
      check_capacidad_disponible: {
        Args: {
          p_persona_id: string;
          p_fecha_inicio: string;
          p_fecha_fin: string;
          p_excluir_id?: string;  // para excluir una asignacion al editar
        };
        Returns: Array<{
          fecha: string;
          ocupacion_pct: number;
        }>;
      };
    };
    Enums: {
      [_ in never]: never;
    };
  };
};
