export function printHumanoid(vrm) {

    console.log("=================================");
    console.log("VRM Humanoid");
    console.log("=================================");

    const humanoid = vrm.humanoid;

    console.log(humanoid);

    console.log("Normalized Bones");
    console.log(humanoid._normalizedHumanBones);

    console.log("Raw Bones");
    console.log(humanoid._rawHumanBones);

    console.log("=================================");
}