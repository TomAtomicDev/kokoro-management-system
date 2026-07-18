# Por qué el WAC puede "driftear" — y por qué se repara de noche en vez de al instante

La clave está en dos decisiones de diseño explícitas en el KB (Doc 03 §7):

- R-1: editar un evento pasado regenera sus filas derivadas (los stock_movements) en un solo batch.
- R-2: pero el WAC no se re-propaga en cascada cuando eso pasa. Cita textual: "cost of replay > value for a microbusiness" — es una decisión de costo/beneficio, no un descuido.

Esto significa que items.wac es un valor cacheado que se actualiza de forma incremental (cada compra dispara C-1 una vez, en el momento en que se registra), no algo que se recalcula desde cero cada vez. El job nocturno (buildWacRepairIfDrifted) existe precisamente para detectar cuándo ese cache incremental se desalineó del "valor verdadero" (el que resulta de reproducir todo el kardex desde cero).

Los dos escenarios operativos reales que generan drift

1. Registro fuera de orden cronológico (el más probable en tu operativa)

El WAC es sensible al orden en que se aplican las entradas — no es como sumar, donde el orden no importa. applyWacEntry usa el on_hand y wac que existen en ese momento para ponderar la nueva compra.

Cuando registras eventos por Telegram, es normal que no lo hagas en tiempo real: compras harina el lunes en el mercado, pero recién le avisas al bot el miércoles porque estabas ocupada. Si mientras tanto ya registraste (el martes) otra compra o una venta, el sistema aplicó C-1 en el orden en que se lo dijiste (orden de created_at), no en el orden en que realmente ocurrió (occurred_at).

El job de reparación, en cambio, siempre reproduce el kardex ordenado por occurred_at (con created_at como desempate) — es decir, el orden real de los hechos. Si el orden de captura difere del orden real, el WAC incremental (calculado en vivo) y el WAC "verdadero" (recalculado por orden real) pueden terminar en números distintos, aunque ambos partan de los mismos movimientos.

2. Edición de un evento pasado

Supón que registraste una compra con un precio equivocado (Bs 50 cuando la factura real decía Bs 45) y la corriges después vía la pantalla de edición (UC-18). R-1 dice que se regenera el movimiento de esa compra con el costo correcto — pero el WAC de items.wac ya avanzó usando el número viejo, y cualquier compra posterior que ya haya aplicado C-1 lo hizo sobre esa base incorrecta. El sistema, por diseño (R-2), no vuelve atrás a "reproducir" todas esas actualizaciones intermedias en tiempo real — sería costoso y, para un negocio de este tamaño, no vale la pena hacerlo síncronamente en cada edición.

Por qué esto es aceptable (y no un bug)

El trade-off (ADR-009) es: mantener las ediciones O(1) — instantáneas, sin importar cuánta historia tenga el ítem — a cambio de tolerar un desfase temporal que se corrige solo, todas las noches, con un margen de tolerancia del 1% (DRIFT_THRESHOLD_RATIO). Si el desfase es menor a 1%, ni se toca — no todo drift amerita una corrección con su propio audit log.

En resumen: el drift no viene de un error de cálculo, viene de que el kardex es la fuente de verdad y el WAC es un cache que se puede desalinear cada vez que la realidad no llega en el mismo orden en que se registra o se corrige después del hecho — algo estructural en un negocio que captura eventos por Telegram, no en tiempo real y con datos que a veces se editan después.

# Cómo se llega a stock negativo y como evitamos que afecte al WAC

INV-8 (Doc 03) lo dice explícito: "Stock MAY go negative (capture-first); negative stock raises a persistent reconciliation flag, never a blocking error." Es una decisión de diseño, no un descuido: el sistema nunca bloquea un movimiento de salida (venta, producción, merma) por falta de stock suficiente registrado. Mirá buildItemStockUpsert (movements.ts:146-169) — nunca rechaza un resultado negativo, solo marca negative_since.

¿Por qué diseñarlo así? Porque es una emprendedora sola capturando eventos por Telegram/móvil, muchas veces después del hecho. Si el sistema le dijera "no puedes vender esto, el stock registrado es 0", la bloquearía en medio de una venta real por un problema que es del registro, no de la realidad física. Capture-first prioriza que el evento quede anotado siempre, y deja la reconciliación para después.

Los caminos reales hacia stock negativo

1. La misma causa raíz que el drift del WAC: orden de captura ≠ orden real. Compra harina el lunes, no le avisa al bot hasta el miércoles. Si el martes ya vendió usando esa harina, el sistema — que solo conoce lo que le has contado hasta ese momento — registra la venta contra un on_hand que todavía no incluye la compra del lunes. El balance cae bajo cero temporalmente, hasta que finalmente registra la compra atrasada.
2. Mermas o pérdidas no registradas todavía. El sistema cree que tiene más stock del que hay físicamente (algo se dañó, se lo comió alguien, etc.) porque el EXIT_OUT correspondiente aún no se capturó. La próxima venta que sí se registra puede empujar el balance a negativo.
3. Edición/eliminación retroactiva de una compra (R-1) después de que ventas posteriores ya "consumieron" ese stock en el sistema — al regenerarse los movimientos de esa compra con una cantidad menor (o al eliminarla), el balance neto puede quedar negativo aunque en su momento pareciera correcto.
4. Saldo inicial no cargado: un ítem que ya tenía stock físico al momento de empezar a usar el sistema, sin un ADJUST inicial que lo refleje — las primeras ventas se registran contra un on_hand que arranca en 0.

En todos los casos, negativo no significa "vendiste algo que no existía en la realidad" — significa que el kardex todavía no tiene el evento que justifica ese stock. Por eso negative_since es una bandera de reconciliación persistente (para que la dueña la revise), no un error bloqueante.

Cómo afecta
Acá es donde el guard max(currentOnHand, 0) (wac.ts:82) se vuelve crítico, por dos razones concretas:

Ejemplo (elobsoleto/irrelevante), y llega una compra real de 1000 @ 400.
-1000 = -200. Un WAC negativo — no tiene sentido económico, y contaminaría cada margen, cada valuación de salida futura que

- Con el guard: max(-2000,0) = 0, entonces wac' = (0×100 + 1000×400) / 1000 = 400 — exactamente el costo de la compra realel WAC desde cero" (mezclado únicamente con el stock que sí es legítimo, si lo hubiera).

Si el balance negativo llegara exactamente a cancelarse con la nueva entrada (ej. on_hand=-1000, entryQty=1000), sin el guard el denominador sería -1000+1000=0 → división por cero. Con el guard, como entryQty siempre es estrictamente positivo (se valida antes) y max(on_hand,0) ≥ 0, el denominador max(on_hand,0) + entryQty es estructuralmente imposible que sea cero — es una garantía matemática, no un chequeo defensivo aparte.

En resumen: el stock negativo es una realidad operativa esperada (registro fuera de orden, mermas no capturadas, ediciones tardías), y applyWacEntry está diseñado para que esa "deuda" en el kardex nunca contamine el costo real de la siguiente compra — el WAC solo se construye a partir de stock que efectivamente tiene una base de costo detrás.
