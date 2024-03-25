import jwt from "jsonwebtoken";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asynchHandler.js";

export const verifyJWT = asyncHandler(async (req, res, next) => {
    try {
        const accessToken =
            req.cookies?.accessToken ||
            req.header("Authorization")?.replace("Bearer ", "");
        if (!accessToken) throw new ApiError(401, "Unauthroized Acess");
        const decodedToken = jwt.verify(
            accessToken,
            process.env.ACCESS_TOKEN_SECRET
        );
        const user = await User.findById(decodedToken?._id).select(
            "-password -refreshToken"
        );
        if (!user) throw new ApiError(401, "Invalid Access Token");
        req.user = user;
        next();
    } catch (error) {
        throw new ApiError(401, error?.message || "Invalid Access Token ");
    }
});
