"use strict";

$(document).ready(function() {
    let map;
    let markers = [];
    let currentUser;

    // Initialize map and check authentication 
    init();

    async function init() {
        try {
            let response = await inviaRichiesta('GET', '/api/checkUser');
            console.log("CheckUser response:", response); // Debug

            if(response.status == 200) {
                currentUser = response.data;
                // Forza il role admin per l'utente Admin
                currentUser.role = currentUser.username === 'Admin' ? 'admin' : 'operator';
                
                $('#userInfo').text(`Benvenuto ${currentUser.username}`);
                
                // Inizializza la mappa
                initMap();
                
                // Se l'utente è admin, carica operatori e perizie
                if(currentUser.username === 'Admin') {
                    await loadOperators();
                    await loadPerizie();
                }
            }
        } catch(err) {
            console.error("Init error:", err);
            window.location.href = 'login.html';
        }
    }

    // Modifica la funzione initMap
    function initMap() {
        // Coordinate del Vallauri
        const center = [44.5557763, 7.7347183];
        
        // Inizializza la mappa
        map = L.map('map').setView(center, 13);
        
        // Aggiungi il layer di OpenStreetMap
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);

        // Crea un'icona personalizzata per la sede centrale
        const sedeIcon = L.divIcon({
            className: 'sede-marker',
            html: '<i class="fas fa-building"></i>',
            iconSize: [40, 40],
            iconAnchor: [20, 40],
            popupAnchor: [0, -40]
        });

        // Aggiungi il marker della sede con l'icona personalizzata e il popup
        L.marker(center, {
            icon: sedeIcon,
            title: 'Sede Centrale',
            zIndexOffset: 1000
        })
        .addTo(map)
        .bindPopup(`
            <div class="sede-popup">
                <h6><i class="fas fa-building mr-2"></i>IIS G. Vallauri</h6>
                <p class="mb-0">Sede Centrale - Fossano</p>
            </div>
        `);
    }

    // Load operators for filter
    async function loadOperators() {
        try {
            let response = await inviaRichiesta('GET', '/api/operators');
            console.log("Operators response:", response); // Debug
            
            if(response.status == 200) {
                $('#operatorFilter').empty();
                $('#operatorFilter').append(`<option value="">Tutti gli operatori</option>`);
                response.data.forEach(op => {
                    $('#operatorFilter').append(`
                        <option value="${op._id}">${op.username}</option>
                    `);
                });
            }
        } catch(error) {
            console.error("Error loading operators:", error);
        }
    }

    // Load perizie with optional operator filter
    async function loadPerizie(operatorId = null, dateFrom = null, dateTo = null) {
        try {
            const params = new URLSearchParams();
            if (operatorId) params.append('operatore', operatorId);
            if (dateFrom) params.append('dateFrom', dateFrom);
            if (dateTo) params.append('dateTo', dateTo);

            const url = `/api/perizie${params.toString() ? '?' + params.toString() : ''}`;
            const response = await inviaRichiesta('GET', url);

            clearMarkers();
            if (response.status === 200 && Array.isArray(response.data)) {
                response.data.forEach(perizia => addMarker(perizia));
            }
        } catch (error) {
            console.error("Error loading perizie:", error);
        }
    }

    // Add marker to map
    function addMarker(perizia) {
        console.log("Adding marker for perizia:", perizia); // Debug

        if (!perizia.coordinate || !perizia.coordinate.latitude || !perizia.coordinate.longitude) {
            console.error("Invalid coordinates for perizia:", perizia);
            return;
        }

        const marker = L.marker([
            perizia.coordinate.latitude,
            perizia.coordinate.longitude
        ]).addTo(map);

        const popupContent = `
            <div class="marker-popup">
                <h6>Perizia del ${new Date(perizia["data-ora"]).toLocaleDateString()}</h6>
                <p><strong>Descrizione:</strong> ${perizia.descrizione}</p>
                ${perizia.foto ? perizia.foto.map(foto => `
                    <div class="perizia-image">
                        <img src="${foto.img}" class="img-fluid mb-2">
                        <p class="small">${foto.commento || ''}</p>
                    </div>
                `).join('') : ''}
            </div>
        `;

        marker.bindPopup(popupContent);
        markers.push(marker);
    }

    // Clear all markers from map
    function clearMarkers() {
        markers.forEach(marker => map.removeLayer(marker));
        markers = [];
    }

    // Aggiungi questa funzione per il marker della sede
    function addSededMarker() {
        const center = [44.5557763, 7.7347183];
        L.marker(center)
            .addTo(map)
            .bindPopup('Sede Centrale')
            .openPopup();
    }

    // Event Handlers
    $('#operatorFilter').on('change', function() {
        loadPerizie($(this).val());
    });

    $('#dateFrom, #dateTo').on('change', function() {
        const dateFrom = $('#dateFrom').val();
        const dateTo = $('#dateTo').val();
        const operatore = $('#operatorFilter').val();
        
        loadPerizie(operatore, dateFrom, dateTo);
    });

    $('#btnAddUser').on('click', async function() {
        let email = $('#newUserEmail').val();
        let password = "password"; // Default password
        
        try {
            let response = await inviaRichiesta('POST', '/api/addOperator', {
                email: email,
                password: password
            });
            
            if(response.status == 200) {
                alert('Nuovo operatore aggiunto con successo');
                $('#newUserModal').modal('hide');
                loadOperators();
            }
        } catch(error) {
            console.error(error);
            alert("Errore durante l'aggiunta dell'operatore");
        }
    });

    // Logout handler
    $('#btnLogout').on('click', async function() {
        try {
            await inviaRichiesta('POST', '/api/logout');
            window.location.href = 'login.html';
        } catch(error) {
            console.error(error);
        }
    });

    async function editPerizia(periziaId) {
        try {
            const response = await inviaRichiesta('GET', `/api/perizie/${periziaId}`);
            if(response.status == 200) {
                const perizia = response.data;
                
                // Popola il modal con i dati della perizia
                $('#periziaContent').html(`
                    <div class="form-group">
                        <label>Descrizione</label>
                        <textarea class="form-control" id="editDescrizione">${perizia.descrizione}</textarea>
                    </div>
                `);
                
                // Popola le immagini
                $('.periziaImages').empty();
                perizia.foto.forEach((foto, index) => {
                    $('.periziaImages').append(`
                        <div class="col-md-4 mb-3">
                            <div class="card">
                                <img src="${foto.img}" class="card-img-top">
                                <div class="card-body">
                                    <textarea class="form-control" id="comment${index}">${foto.commento}</textarea>
                                </div>
                            </div>
                        </div>
                    `);
                });
                
                $('#periziaDetailModal').modal('show');
                
                // Gestione salvataggio modifiche
                $('#btnSaveChanges').off('click').on('click', async () => {
                    const updatedPerizia = {
                        descrizione: $('#editDescrizione').val(),
                        foto: perizia.foto.map((foto, index) => ({
                            img: foto.img,
                            commento: $(`#comment${index}`).val()
                        }))
                    };
                    
                    try {
                        await inviaRichiesta('PUT', `/api/perizie/${periziaId}`, updatedPerizia);
                        $('#periziaDetailModal').modal('hide');
                        loadPerizie(); // Ricarica le perizie
                    } catch(error) {
                        console.error(error);
                        alert("Errore durante il salvataggio delle modifiche");
                    }
                });
            }
        } catch(error) {
            console.error(error);
        }
    }

    // Aggiungi questo handler in index.js
    $('#btnDebug').on('click', async function() {
        try {
            const perizie = await inviaRichiesta('GET', '/api/perizie');
            console.log("All perizie:", perizie);
            
            const operators = await inviaRichiesta('GET', '/api/operators');
            console.log("All operators:", operators);
            
            console.log("Current user:", currentUser);
        } catch(error) {
            console.error("Debug error:", error);
        }
    });
});
