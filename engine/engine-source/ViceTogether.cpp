// Copyright (c) 2026 ViceTogether contributors. MIT.
// This bridge is experimental until tested with the user's own game assets.
#include "common.h"
#include "ViceTogether.h"
#include "PlayerPed.h"
#include "Ped.h"
#include "World.h"
#include "ModelIndices.h"
#include "Weapon.h"
#include "Timer.h"
#include <cmath>
#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

namespace {
struct Remote {
    CPed* ped;
    bool active;
    float x, y, z, heading;
    int move;
};
Remote peers[7] = {};
bool enabled = false;
bool finitePosition(float x, float y, float z) {
    return std::isfinite(x) && std::isfinite(y) && std::isfinite(z)
        && std::fabs(x) < 10000 && std::fabs(y) < 10000 && std::fabs(z) < 3000;
}
}

extern "C" {
EMSCRIPTEN_KEEPALIVE int VT_Version() { return 1; }
// Bit 0: on-foot transforms and locomotion only. Vehicles/combat are not implemented.
EMSCRIPTEN_KEEPALIVE int VT_Capabilities() { return 1; }
EMSCRIPTEN_KEEPALIVE void VT_Enable(int value) { enabled = value != 0; }
EMSCRIPTEN_KEEPALIVE int VT_ReadLocal(float* out) {
    CPlayerPed* player = FindPlayerPed();
    if (!out || !player || !player->m_rwObject) return 0;
    const CVector& p = player->GetPosition();
    out[0] = p.x; out[1] = p.y; out[2] = p.z;
    out[3] = player->m_fRotationCur;
    out[4] = player->GetMoveSpeed().x;
    out[5] = player->GetMoveSpeed().y;
    out[6] = player->GetMoveSpeed().z;
    out[7] = (float)player->m_nMoveState;
    out[8] = player->m_fHealth;
    out[9] = player->bInVehicle ? 1.0f : 0.0f;
    return finitePosition(out[0], out[1], out[2]) ? 1 : 0;
}
EMSCRIPTEN_KEEPALIVE void VT_SetRemote(int slot, float x, float y, float z, float heading, int move) {
    if (slot < 0 || slot >= 7 || !finitePosition(x, y, z) || !std::isfinite(heading)) return;
    Remote& r = peers[slot];
    r.active = true; r.x = x; r.y = y; r.z = z; r.heading = heading;
    r.move = move >= PEDMOVE_STILL && move <= PEDMOVE_SPRINT ? move : PEDMOVE_STILL;
}
EMSCRIPTEN_KEEPALIVE void VT_RemoveRemote(int slot) {
    if (slot < 0 || slot >= 7) return;
    peers[slot].active = false;
}
}

void ViceTogetherTick() {
    CPlayerPed* player = FindPlayerPed();
    if (!player || !player->m_rwObject) return;
    for (int i = 0; i < 7; ++i) {
        Remote& r = peers[i];
        if (!enabled || !r.active) {
            if (r.ped) {
                CWorld::Remove(r.ped);
                delete r.ped;
                r.ped = nil;
            }
            continue;
        }
        if (!r.ped) {
            // The player's model is already resident. Do not request another skin synchronously.
            r.ped = new CPed(PEDTYPE_CIVMALE);
            r.ped->SetModelIndex(player->GetModelIndex());
            r.ped->CharCreatedBy = MISSION_CHAR;
            r.ped->bRespondsToThreats = false;
            r.ped->bUsesCollision = false;
            r.ped->RegisterReference((CEntity**)&r.ped);
            r.ped->SetPosition(r.x, r.y, r.z);
            CWorld::Add(r.ped);
        }
        // Local AI/world simulation is not authoritative for a remote player.
        r.ped->SetPedState(PED_IDLE);
        r.ped->SetMoveState((eMoveState)r.move);
        r.ped->SetMoveAnim();
        r.ped->SetMoveSpeed(0.0f, 0.0f, 0.0f);
        r.ped->bIsStanding = true;
        r.ped->SetPosition(r.x, r.y, r.z);
        r.ped->m_fRotationCur = r.ped->m_fRotationDest = r.heading;
        r.ped->SetOrientation(0.0f, 0.0f, r.heading);
        r.ped->UpdateRwFrame();
    }
}
